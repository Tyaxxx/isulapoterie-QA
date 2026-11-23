ISULA POTERIE - HOW TO MANAGE THE WEBSITE PHOTOS
================================================

The website photos live here, in the "photo-sources" folder.
This is the ONLY photo folder you should edit. Never put a photo directly
into website/photos: that folder is rebuilt automatically (it holds
corrected copies) and anything you change there would be lost.

The website reads the photo names to decide in which order to show them
and which caption (Faïence, Grès...) to write under them. There is no code
to change.


1. CATEGORIES = FOLDERS
-----------------------

Each folder is one category of the "Réalisations" page:

    01-bols-coupelles   ->  "Bols - Coupelles"
    02-plats            ->  "Plats"
    03-vases            ->  "Vases"
    04-autres-divers    ->  "Autres - Divers"

- The number at the start sets the order of the categories on the page.
- The rest of the name gives the title: each word gets a capital letter
  and the words are separated by " - ".
- For a title with accents (for example "Théières"), create a text file
  named title.txt in the folder, with the title on its first line. That
  title replaces the one taken from the folder name.
- A folder without photos does not appear on the website.
- Folder names and photo names are shown to visitors, so they stay in
  French.


2. THE NAME OF A PHOTO
----------------------

Format: NUMBER-material.jpg   (lowercase, no accents, no spaces)

    01-faience.jpg     ->  1st photo of the category, caption "Faïence"
    02-gres.jpg        ->  2nd photo, caption "Grès"
    05-email-bleu.jpg  ->  caption "Email bleu"
    07.jpg             ->  no caption

- The number sets the order within the category.
- "faience" automatically becomes "Faïence" and "gres" becomes "Grès".
  Other words are kept as they are.
- To slip a photo between 03 and 04, name it 03b-gres.jpg.
- Accepted formats: .jpg, .jpeg, .png, .webp. A .png is published as .jpg.
  A .webp is published as is, without correction.


3. AUTOMATIC PHOTO CORRECTION
-----------------------------

On every update, the photos are corrected so that they all have the same
light: same bright backdrop, same white, same contrast. The colours of the
pieces are not changed (only the light is). The photos in this folder are
never modified: the corrected version goes to website/photos.

To see the result, open photo-comparison.html (double-click, at the
project root): every photo is shown before / after.

If a photo looks worse after correction, add ".no-correction" at the end
of its name, just before .jpg:

    07-gres.no-correction.jpg   ->  published as is, under the name
                                    07-gres.jpg (caption "Grès")


4. ADD, REMOVE, RENAME, REORDER
-------------------------------

- Add a photo: copy it into the right folder and name it as above.
- Remove a photo: delete the file (or move it out of "photo-sources").
  Its copy disappears from the website too.
- Change a caption or the order: rename the file.
- Add a category: create a new folder (for example 05-theieres) and put
  photos in it. Add a title.txt if the title needs accents.
- Change the order of the categories: change the number at the start of
  the folder name.

Then, EVERY TIME:

    1. Double-click "update-photos.bat"
       (at the project root, just above this folder).
       A window shows for example:
           42 photos: 3 corrected, 39 unchanged, 0 deleted. ...
           4 categories, 42 photos — photos.js updated.
       "Warning" lines point to a name or a photo to check.
       Press any key to close the window.
    2. Open photo-comparison.html to check the corrected photos.
    3. Reload the website page in the browser (F5 key).

The first time, Windows may show "Windows protected your PC": click
"More info", then "Run anyway".


5. GOOD TO KNOW
---------------

- Never edit photos.js or the website/photos folder by hand: they are
  rebuilt every time update-photos.bat runs.
- Recommended photo size: about 1600 pixels wide and under 500 KB, in 4:3
  landscape format. The website grid crops photos to 4:3; the viewer shows
  them in full.
- Photograph the pieces on the same light paper, without letting them
  touch the edges of the photo: the correction measures the backdrop along
  the edges.
- After an update, upload the whole "website" folder to the web host (not
  only the new photos).
