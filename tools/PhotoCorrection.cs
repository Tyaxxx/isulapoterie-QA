// Photo correction engine (same light on every photo).
// Loaded by correct-photos.ps1 (Add-Type). All tuning lives in the SETTINGS
// block of correct-photos.ps1: do not tune anything here.
//
// Constraints: C# 5 (the Windows PowerShell 5.1 compiler), no "unsafe" code,
// ASCII only.
//
// Method (in linear light):
//   1. backdrop = the paper, measured in a band along the image border;
//   2. gentle black point;
//   3. one gain per channel, computed from the neutral backdrop only: the
//      backdrop becomes BackdropTarget, neutral grey; the pieces keep their
//      channel ratios (hue is preserved);
//   4. gentle S-curve contrast below the backdrop;
//   5. soft highlight shoulder (no clipping);
//   6. blend with the original according to Strength.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace Isula
{
    public class Settings
    {
        public double BackdropTarget = 235;
        public double Strength = 1.0;
        public double WhiteBalance = 1.0;
        public double GainMax = 4.0;
        public double GainMin = 0.7;
        public double MaxTintShift = 1.25;
        public double BlackTarget = 8;
        public double BlackStrength = 0.5;
        public double BlackMax = 20;
        public double Contrast = 0.10;
        public double HighlightMax = 250;
        public double Border = 0.06;
        public double BackdropMaxSaturation = 0.12;
        public int JpegQuality = 90;
    }

    public class Result
    {
        public double BackdropR, BackdropG, BackdropB;
        public double BackdropAfterR, BackdropAfterG, BackdropAfterB;
        public double GainR = 1, GainG = 1, GainB = 1;
        public double BlackRemoved;
        public int Width, Height;
        public bool BackdropDetected;
        public bool GainCapped;
        public bool TintCapped;
        public bool HadTransparency;
        public string Warning;
    }

    public static class PhotoCorrection
    {
        public const double MaxBorder = 0.45;

        static readonly float[] ToLinear = new float[256];
        static readonly byte[] ToSrgb = new byte[4096];

        static PhotoCorrection()
        {
            for (int i = 0; i < 256; i++) ToLinear[i] = (float)Lin(i / 255.0);
            for (int i = 0; i < 4096; i++)
            {
                int v = (int)Math.Round(Enc(i / 4095.0) * 255.0);
                ToSrgb[i] = (byte)Math.Max(0, Math.Min(255, v));
            }
        }

        static double Lin(double v)
        {
            if (v <= 0) return 0;
            if (v >= 1) return 1;
            return v <= 0.04045 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
        }

        static double Enc(double v)
        {
            if (v <= 0) return 0;
            if (v >= 1) return 1;
            return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.Pow(v, 1 / 2.4) - 0.055;
        }

        static byte ToByte(double lin)
        {
            int i = (int)(lin * 4095.0 + 0.5);
            if (i < 0) i = 0; else if (i > 4095) i = 4095;
            return ToSrgb[i];
        }

        public static Result Process(string source, string destination, Settings s, bool correct)
        {
            Result res = new Result();
            byte[] px;
            int w, h, stride;

            using (FileStream fs = new FileStream(source, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (Image img = Image.FromStream(fs, true, false))
            {
                RotateFlipType rf = Orientation(img);
                if (rf != RotateFlipType.RotateNoneFlipNone) img.RotateFlip(rf);
                Bitmap bmp = img as Bitmap;
                if (bmp == null) throw new InvalidOperationException("unsupported image format");
                w = bmp.Width; h = bmp.Height;
                if (Image.IsAlphaPixelFormat(bmp.PixelFormat))
                {
                    px = ReadOnWhite(bmp, w, h, out stride, out res.HadTransparency);
                }
                else
                {
                    BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                    try
                    {
                        stride = Math.Abs(d.Stride);
                        px = new byte[stride * h];
                        Marshal.Copy(d.Scan0, px, 0, px.Length);
                    }
                    finally { bmp.UnlockBits(d); }
                }
            }
            res.Width = w; res.Height = h;

            int br, bg, bb;
            res.BackdropDetected = MeasureBackdrop(px, w, h, stride, s, out br, out bg, out bb);
            res.BackdropR = br; res.BackdropG = bg; res.BackdropB = bb;

            if (correct && !res.BackdropDetected)
            {
                res.Warning = "backdrop not detected, photo left uncorrected";
            }
            else if (correct)
            {
                Correct(px, w, h, stride, s, res);
            }

            if (correct && res.BackdropDetected)
            {
                int ar, ag, ab;
                MeasureBackdrop(px, w, h, stride, s, out ar, out ag, out ab);
                res.BackdropAfterR = ar; res.BackdropAfterG = ag; res.BackdropAfterB = ab;
            }
            else
            {
                res.BackdropAfterR = br; res.BackdropAfterG = bg; res.BackdropAfterB = bb;
            }

            Save(px, w, h, stride, destination, s.JpegQuality);
            return res;
        }

        // Images with an alpha channel (PNG): composite over white, as a web page would.
        static byte[] ReadOnWhite(Bitmap bmp, int w, int h, out int stride, out bool hadTransparency)
        {
            hadTransparency = false;
            BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            byte[] argb;
            int srcStride;
            try
            {
                srcStride = Math.Abs(d.Stride);
                argb = new byte[srcStride * h];
                Marshal.Copy(d.Scan0, argb, 0, argb.Length);
            }
            finally { bmp.UnlockBits(d); }
            stride = (w * 3 + 3) & ~3;
            byte[] px = new byte[stride * h];
            for (int y = 0; y < h; y++)
            {
                int i = y * srcStride, o = y * stride;
                for (int x = 0; x < w; x++, i += 4, o += 3)
                {
                    int a = argb[i + 3];
                    if (a < 255) hadTransparency = true;
                    for (int c = 0; c < 3; c++)
                        px[o + c] = (byte)((argb[i + c] * a + 255 * (255 - a) + 127) / 255);
                }
            }
            return px;
        }

        static RotateFlipType Orientation(Image img)
        {
            if (Array.IndexOf(img.PropertyIdList, 0x0112) < 0) return RotateFlipType.RotateNoneFlipNone;
            PropertyItem p = img.GetPropertyItem(0x0112);
            if (p.Value == null || p.Value.Length < 1) return RotateFlipType.RotateNoneFlipNone;
            int o = p.Value.Length >= 2 ? BitConverter.ToUInt16(p.Value, 0) : p.Value[0];
            switch (o)
            {
                case 2: return RotateFlipType.RotateNoneFlipX;
                case 3: return RotateFlipType.Rotate180FlipNone;
                case 4: return RotateFlipType.RotateNoneFlipY;
                case 5: return RotateFlipType.Rotate90FlipX;
                case 6: return RotateFlipType.Rotate90FlipNone;
                case 7: return RotateFlipType.Rotate270FlipX;
                case 8: return RotateFlipType.Rotate270FlipNone;
                default: return RotateFlipType.RotateNoneFlipNone;
            }
        }

        static void Save(byte[] px, int w, int h, int stride, string destination, int quality)
        {
            // A fresh bitmap: no metadata (EXIF, GPS) is carried over.
            using (Bitmap output = new Bitmap(w, h, PixelFormat.Format24bppRgb))
            {
                BitmapData d = output.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                try
                {
                    int row = w * 3;
                    for (int y = 0; y < h; y++)
                        Marshal.Copy(px, y * stride, new IntPtr(d.Scan0.ToInt64() + (long)y * d.Stride), row);
                }
                finally { output.UnlockBits(d); }

                ImageCodecInfo jpeg = null;
                foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders())
                    if (c.MimeType == "image/jpeg") jpeg = c;
                using (EncoderParameters ep = new EncoderParameters(1))
                {
                    ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
                    output.Save(destination, jpeg, ep);
                }
            }
        }

        static int Percentile(int[] hist, long n, double p)
        {
            long threshold = (long)Math.Ceiling(p * n);
            if (threshold < 1) threshold = 1;
            long cum = 0;
            for (int i = 0; i < hist.Length; i++)
            {
                cum += hist[i];
                if (cum >= threshold) return i;
            }
            return hist.Length - 1;
        }

        static int Luma(int r, int g, int b)
        {
            return (int)Math.Round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        }

        // Backdrop = paper in the border band: low-saturation, not too dark pixels,
        // between the 50th and 95th luma percentiles; per-channel median (sRGB 0-255).
        static bool MeasureBackdrop(byte[] px, int w, int h, int stride, Settings s, out int br, out int bg, out int bb)
        {
            br = bg = bb = 0;
            double border = Math.Max(0, Math.Min(MaxBorder, s.Border));
            int bw = Math.Max(1, (int)Math.Round(w * border));
            int bh = Math.Max(1, (int)Math.Round(h * border));
            List<int> offsets = new List<int>();
            List<int> lumas = new List<int>();
            int[] histL = new int[256];
            long total = 0;
            for (int y = 0; y < h; y++)
            {
                bool fullRow = y < bh || y >= h - bh;
                for (int x = 0; x < w; x++)
                {
                    if (!fullRow && x >= bw && x < w - bw) continue;
                    total++;
                    int o = y * stride + x * 3;
                    int b = px[o], g = px[o + 1], r = px[o + 2];
                    int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
                    if (max == 0) continue;
                    if ((max - min) / (double)max > s.BackdropMaxSaturation) continue;
                    int L = Luma(r, g, b);
                    if (L < 60) continue;
                    offsets.Add(o); lumas.Add(L); histL[L]++;
                }
            }
            if (offsets.Count < 0.05 * total || offsets.Count == 0) return false;
            int lo = Percentile(histL, offsets.Count, 0.50);
            int hi = Percentile(histL, offsets.Count, 0.95);
            int[] hr = new int[256], hg = new int[256], hb = new int[256];
            long n = 0;
            for (int i = 0; i < offsets.Count; i++)
            {
                if (lumas[i] < lo || lumas[i] > hi) continue;
                int o = offsets[i];
                hb[px[o]]++; hg[px[o + 1]]++; hr[px[o + 2]]++; n++;
            }
            br = Percentile(hr, n, 0.5); bg = Percentile(hg, n, 0.5); bb = Percentile(hb, n, 0.5);
            return true;
        }

        static void Correct(byte[] px, int w, int h, int stride, Settings s, Result res)
        {
            double T = Lin(s.BackdropTarget / 255.0);
            double encT = s.BackdropTarget / 255.0;
            // Channels in buffer order: 0 = B, 1 = G, 2 = R.
            double[] B = { Lin(res.BackdropB / 255.0), Lin(res.BackdropG / 255.0), Lin(res.BackdropR / 255.0) };
            double[] coef = { 0.0722, 0.7152, 0.2126 };
            double Yb = coef[0] * B[0] + coef[1] * B[1] + coef[2] * B[2];

            // 2. Black point: 0.5th luma percentile of the whole image.
            int[] histL = new int[256];
            for (int y = 0; y < h; y++)
            {
                int o = y * stride;
                for (int x = 0; x < w; x++, o += 3) histL[Luma(px[o + 2], px[o + 1], px[o])]++;
            }
            int D = Percentile(histL, (long)w * h, 0.005);
            double k = Math.Max(0, Math.Min(s.BlackMax, s.BlackStrength * (D - s.BlackTarget)));
            double kLin = Lin(k / 255.0);
            res.BlackRemoved = k;

            // 3. Per-channel gains, computed from the backdrop only.
            double gExpo = T / Math.Max(1e-6, Yb - kLin);
            double gClamped = Math.Max(s.GainMin, Math.Min(s.GainMax, gExpo));
            if (Math.Abs(gClamped - gExpo) > 1e-9)
            {
                res.GainCapped = true;
                res.Warning = "gain capped (x" + gExpo.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + " requested)";
            }
            double[] wb = new double[3];
            for (int c = 0; c < 3; c++)
            {
                double target = T * Math.Pow(B[c] / Yb, 1 - s.WhiteBalance);
                wb[c] = target / Math.Max(1e-6, B[c] - kLin) / gExpo;
            }
            double wMax = Math.Max(wb[0], Math.Max(wb[1], wb[2])), wMin = Math.Min(wb[0], Math.Min(wb[1], wb[2]));
            if (wMax / wMin > s.MaxTintShift && s.MaxTintShift >= 1)
            {
                double mean = (Math.Log(wb[0]) + Math.Log(wb[1]) + Math.Log(wb[2])) / 3;
                double f = Math.Log(s.MaxTintShift) / Math.Log(wMax / wMin);
                for (int c = 0; c < 3; c++) wb[c] = Math.Exp(mean + (Math.Log(wb[c]) - mean) * f);
                res.TintCapped = true;
                string a = "backdrop tint too strong, correction capped";
                res.Warning = res.Warning == null ? a : res.Warning + "; " + a;
            }
            double[] G = new double[3];
            for (int c = 0; c < 3; c++) G[c] = gClamped * wb[c];
            res.GainB = G[0]; res.GainG = G[1]; res.GainR = G[2];

            double L = Math.Max(T + 0.01, Lin(s.HighlightMax / 255.0));
            double C = s.Contrast, strength = s.Strength;
            double[] v = new double[3], o0 = new double[3];
            for (int y = 0; y < h; y++)
            {
                int o = y * stride;
                for (int x = 0; x < w; x++, o += 3)
                {
                    for (int c = 0; c < 3; c++)
                    {
                        o0[c] = ToLinear[px[o + c]];
                        double t = (o0[c] - kLin) * G[c];
                        v[c] = t < 0 ? 0 : t;
                    }
                    // 4. S-curve contrast below the backdrop (same factor on all 3 channels).
                    if (C != 0)
                    {
                        double Y = coef[0] * v[0] + coef[1] * v[1] + coef[2] * v[2];
                        if (Y > 0 && Y < T)
                        {
                            double e = Enc(Y) / encT;
                            double e2 = e + (e * e * (3 - 2 * e) - e) * C;
                            double sc = Lin(e2 * encT) / Y;
                            v[0] *= sc; v[1] *= sc; v[2] *= sc;
                        }
                    }
                    // 5. Soft shoulder above the backdrop: approaches HighlightMax without reaching it.
                    double m = Math.Max(v[0], Math.Max(v[1], v[2]));
                    if (m > T)
                    {
                        double m2 = T + (L - T) * (1 - Math.Exp(-(m - T) / (L - T)));
                        double sc = m2 / m;
                        v[0] *= sc; v[1] *= sc; v[2] *= sc;
                    }
                    // 6. Blend with the original.
                    for (int c = 0; c < 3; c++)
                        px[o + c] = ToByte(o0[c] + (v[c] - o0[c]) * strength);
                }
            }
        }
    }
}
