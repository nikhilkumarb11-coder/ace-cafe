# Ace Café

Static till for Ace Café. It installs on a phone or counter, keeps every bill on the device, and syncs to a Google Sheet when one is connected. Same engine as Madeena Grand Fireworks: no build step, IndexedDB on the device, Apps Script in front of the Sheet.

```
index.html            app shell
config.js             café name, logo, API URL
css/                  Sneat, recoloured gold
js/                   store, sync, till, menu, bills, today, expenses, day close
apps-script/Code.gs   backend (paste into the Sheet)
assets/logo.png       the marble mark
```

The POS is the home screen. Menu prices already include GST. Each device prints its own bill numbers (`C1-0004`) so the receipt does not wait on the network.

## Use it on one device

Open `index.html` (or any static host) and choose **Continue on this device**. A sample menu is created the first time. Edit or delete it under Menu.

## Connect a Google Sheet

1. Create a Sheet, for example "Ace Café".
2. **Extensions → Apps Script**. Replace the sample with `apps-script/Code.gs`, and set the time zone to **(GMT+05:30) India Standard Time**.
3. Run **`setup`**. Approve the prompt. This creates the tabs, a sample menu, and the **Ace Café** menu.
4. **Ace Café → Set app password**.
5. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Copy the URL ending in `/exec`.
6. Paste it into `config.js` → `apiUrl`.
7. Reload the app and log in. Anything saved on the device before this is sent up.

When `Code.gs` changes later: paste, save, then **Deploy → Manage deployments → Edit → New version**. The URL stays the same. Then **Ace Café → Repair missing columns** if the tabs need new fields.

## Releasing a change

Bump every `?v=N` in `index.html` and `VERSION` in `sw.js` together. Installed copies then offer a reload.

The service worker is off on `localhost`. Set `localStorage.ace_sw = 1` to test it.

## What is stored

`MenuCategories`, `MenuItems`, `Bills`, `BillItems`, `BillPayments`, `Expenses`, `DayCloses`, `Settings`.

Rows are not deleted. A voided bill stays void. A payment is voided rather than edited. Day close keeps the sales figures from the moment it was saved.
