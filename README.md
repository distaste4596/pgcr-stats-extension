# PGCR Stats Extension

Extended view for stats on raid.report and dungeon.report profiles and PGCR pages with some improvements to other parts of the websites

## Features

### PGCR pages 
- Fireteam table with kills, deaths, assists, K/D, kill share, precision kills, time played, an MVP pick, summary tiles and a weapon breakdown by slot.
- Click a player to see a player specific info breakdown.
### Profiles
- Shows the clan in the emblem (links to raidhub.io) and adds quick links to raid.report/dungeon.report, pgcr.report and Bungie.net.
- Private profiles no longer end in an error. Clears, ranks and fastest times stay visible, with a notice that the activity history can't be loaded. (This doesn't add anything that raid.report/dungeon.report wasn't showing before, now it's just easier to navigate)
- Faster loading caches account stats and loads activity pages ahead of time, with a reload notice when a new character is found.

## Installing the extension

### Chrome

1. Download the `pgcr-stats-extension.zip` file from the [releases page](https://github.com/distaste4596/pgcr-stats-extension/releases/latest)
2. Extract the `pgcr-stats-extension.zip` file to a folder on your computer.
3. Open Chrome and go to the URL `chrome://extensions/`.
4. Enable "Developer mode" by toggling the switch in the top right corner.
5. Click the "Load unpacked" button.
6. Select the folder where you extracted the zip file.

### Firefox

1. Download the `pgcr-stats-extension.zip` file from the [releases page](https://github.com/distaste4596/pgcr-stats-extension/releases/latest)
2. Extract the `pgcr-stats-extension.zip` file to a folder on your computer.
3. Open Firefox and go to the URL `about:addons`.
4. Click the gear icon and select "Install Add-on From File...".
5. Select the `.xpi` file from the folder where you extracted the zip file and click "Add".

## Updating the extension

### Chrome

1. Download the new `pgcr-stats-extension.zip` file from the [releases page](https://github.com/distaste4596/pgcr-stats-extension/releases/latest)
2. Extract it and replace the files in the folder you installed the extension from.
3. Go to `chrome://extensions/` and click the reload button on the extension.

### Firefox

1. Download the new `pgcr-stats-extension.zip` file from the [releases page](https://github.com/distaste4596/pgcr-stats-extension/releases/latest)
2. Extract it and install the new `.xpi` file the same way as above. It replaces the old version.
