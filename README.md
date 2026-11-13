# Kite Bot Status

A Chrome extension that shows your [Kite](https://github.com/merlinfuchs/kite) Discord bot's status and monthly credit usage right from the toolbar.

## Features

- **Toolbar badge:** the selected bot's credit percentage. Green under 80%, yellow from 80%, red when out of credits, when Discord rejects the bot token, or when there is a new error. Gray when the app is off.
- **Popup:** online status, credits used out of your limit, credits left, and server count. Opens with a loading placeholder and slides between pages. "Updated" counts up while the popup is open.
- **Logged-out screen:** if you are not logged in to Kite, the popup shows a "Log in to Kite" button instead of an error.
- **Bot switcher:** switch between up to 10 bots from a dropdown at the top. Each bot has a status dot.
- **Error alerts:** a banner with the latest error. Click it to expand the last 5 errors with their times, each linking to the logs. Dismiss it with the X; it comes back when a newer error appears.
- **Notifications:** new errors for any of your bots, credit warnings at 80% and 100%, and when a bot goes offline. Clicking an error notification opens that bot's logs.
- **Quiet hours:** pause notifications between two times. A yellow moon shows in the popup while it is enabled.
- **Usage page:** credits per day, daily average, on-pace forecast, reset date, and usage by type (Commands, Messages, Events).
- **Start / stop:** turn the selected bot on or off (needs your Kite login). The popup shows "Stopping…" or "Starting…", then the new state right away.
- **Copy button:** copy the Discord application ID when Kite provides it.
- **Keyboard:** Escape closes the bot dropdown (or the usage page), arrow keys, Home and End move through the bots, and Enter selects.
- **Quick links:** Dashboard, Commands, Events and Logs for the selected bot.
- **Themes:** system, light or dark, set in Settings.
- **Settings:** test your connection, see the extension version, and jump to the GitHub repo.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Pin the extension from the puzzle-piece menu.

## Setup

1. Log in to Kite in the same Chrome. The extension uses your Kite login, so no token is needed.
2. Open the extension's **Settings** (right-click the icon, then Options).
3. Leave the API URL as `https://api.kite.onl`, or enter your own Kite API address if you self-host. Approve the permission prompt for that address.
4. Click **Test connection** to check the address and your login. It shows who you are logged in as and how many bots it found, without saving anything.
5. Click **Save & connect**. The button shows "Saved" when it worked.

If you are not logged in to Kite in that browser, you can paste an API token instead (Kite user menu, then API tokens). Note that API tokens cannot start or stop a bot.

## Project structure

```
manifest.json            Extension manifest (must stay in the root)
icons/                   Extension and toolbar icons
scripts/                 check.js, the checks that CI runs
.github/                 CI workflow and Dependabot config
src/
  background/            Background service worker: polling, badge, notifications
  popup/                 Toolbar popup (status, usage page, bot switcher)
  options/               Settings page
  shared/                Code and styles used by all of the above (Kite API client, quiet hours, theme)
```

## How it works

The extension talks to the Kite API (`/v1/apps/...`) with your session cookie or API token. A background worker checks every 30 seconds:

- The list of bots (status of every bot).
- Error logs for every bot, for notifications.
- Credits for the selected bot only, and its plan limit every 5 minutes.

With 10 bots that is about 24 requests a minute. Kite allows 60 requests a minute per user, shared with the dashboard. If Kite rate limits a request, the extension skips it and tries again on the next check.

Credits are counted per calendar month in UTC, the same as Kite's dashboard.

## Privacy

Everything is stored locally in Chrome (`chrome.storage.local`). The extension only contacts the Kite API address you configure. Nothing is sent anywhere else.

## Troubleshooting

- **Not logged in:** log in to Kite in this browser, or add an API token in Settings.
- **Route not found:** check the API URL in Settings. It must be the API address, for example `https://api.kite.onl`, not the dashboard address.
- **No notifications:** check quiet hours, the "Notify me when new errors appear" setting, and that Windows or Chrome is not blocking notifications for the extension.
- **Some data unavailable:** the popup names the request that failed. This usually means your Kite server is older and lacks that endpoint.

## Development

There are no dependencies or build step. Load the folder as an unpacked extension to try changes. Before pushing, run the checks (needs Node 18 or newer):

```
node scripts/check.js
```

The same checks run in GitHub Actions on every push and pull request (`.github/workflows/ci.yml`), and Dependabot keeps the Action versions up to date (`.github/dependabot.yml`).

## Updating

Pull or download the latest version over the old folder, then click the reload icon on the extension at `chrome://extensions`.
