# Setup guide

## 1. Guest list (Google Sheet)
Use the tab called **Engagement** in the guest sheet. The header row (row 1, or one of the first 5 rows if you keep totals above it) must contain these headers, in any order; extra columns (Group, notes…) are fine and stay private:

`Name 1` · `Name 2` · `Name 3` · `Name 4` · `Seats` · `Code` · `RSVP` · `Updated at`

Optional: `Title`, e.g. `Mr. & Mrs.` or `Miss`. The cover then reads "Dear Mr. & Mrs." above the names.

- `Seats` = how many people the invitation covers (blank = number of names).
- `Code` must be unique per row. Leave it empty and run **generateCodes** to get random codes, or type your own; run **checkCodes** to find duplicates.
- RSVP fills itself: blank = no reply, 0 = declined, 1/2/… = number coming.

## 2. Backend (Google Apps Script), separate from the wedding one
1. Go to **script.google.com** → **New project**. Name it "Engagement RSVP".
2. Delete the sample code and paste the whole of `apps-script/Code.gs`.
3. At the top, fill in:
   - `SHEET_ID`: the long part of the sheet's address, between `/d/` and `/edit`.
   - `GIFT`: bank name, currency, account number and account name. (Only fill these in the Apps Script editor, never in GitHub.)
4. Save. Choose **checkCodes** → **Run** (approve permissions the first time) and fix any duplicates it lists. Then choose **generateCodes** in the function menu at the top → **Run** → approve the permissions (first time only). Every guest row now has a code.
5. **Deploy → New deployment → ⚙ → Web app**. Execute as: **Me**. Who has access: **Anyone**. → **Deploy** → copy the **Web app URL**.
6. Put that URL in `assets/js/config.js` as `apiUrl` (Claude can do this for you).
7. Whenever `Code.gs` changes: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (the URL stays the same).

## 3. Website (Vercel)
1. vercel.com → **Add New… → Project** → import `mickeysalim/engagementinvitation`.
2. Framework preset: **Other**. No build command. Output directory: leave empty (the repository root). → **Deploy**.
3. Every push to `main` updates the site automatically.

## 4. Personal links for WhatsApp
In the Apps Script editor set `SITE_URL` to the website address (e.g. `https://engagement.yourdomain.com`), save, then choose **createLinks** → **Run**. A `Link` column appears with each guest's link: `https://…/?u=code`.

## 5. Your own domain (later)
Use a subdomain of the wedding domain, e.g. `engagement.yourdomain.com`:
1. In this Vercel project: **Settings → Domains → Add** → type the subdomain.
2. Vercel shows one or two DNS records (a CNAME, and a TXT record because the main domain belongs to another Vercel account).
3. Whoever manages the domain adds those records at the domain provider. The wedding site is not affected.
4. Update `SITE_URL` in Apps Script and run **createLinks** again.

## 6. Music
Add the song as `assets/audio/<name>.mp3` (ideally under 5 MB) and set `musicSrc` in `assets/js/config.js`. The music button stays hidden while `musicSrc` is empty.

## 7. Try it
While `apiUrl` is empty the site runs in **Preview mode** with sample guests:
`/?u=demo` · `/?u=demo-solo` · `/?u=demo-long` · `/?u=demo-four`. Without `?u=` the cover says "Dear Family & Friends" and the RSVP and bank details are hidden.

## Privacy
Pages are `noindex`. The backend only returns the one guest whose code is in the link, and the bank details are only sent with a valid code; they are not in the website's code.

## Tests
`node tests/apps-script.test.js` (backend) and `NODE_PATH=$(npm root -g) node tests/e2e.test.js` (browser; screenshots in `tests/screenshots/`).
