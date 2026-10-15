# Mickey & Edmund · The Engagement

Invitation website for the engagement (Sangjit) of Mickey & Edmund, Saturday 20 March 2027, Riviera Ballroom, Arena Lakeside, Sunter, Jakarta.

- Static HTML/CSS/JS, no build step, hosted on Vercel.
- Guest links look like `/?u=<code>`; the page asks a Google Apps Script web app for that one guest's names, seats and RSVP.
- RSVP is written back to the **Engagement** tab of the guest Google Sheet.

| Path | What it is |
|---|---|
| `index.html` | The page |
| `assets/css/styles.css` | Styles (Peranakan palette, phone first) |
| `assets/js/config.js` | Settings: API URL, RSVP deadline, links, music, event times |
| `assets/js/app.js` | Cover, RSVP, gift, slideshow, gallery viewer, scroll reveals |
| `assets/save-the-date.ics` | Calendar file for iPhone / Outlook |
| `apps-script/Code.gs` | Backend to paste into Google Apps Script |
| `docs/SETUP.md` | Step-by-step setup |
| `tests/` | Backend and browser tests |
