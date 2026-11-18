# Star Citizen ship availability monitor

This Windows application watches an RSI ship shop page for an actionable **Add
to Cart** button. When it becomes available, the app attempts to add that ship to
your cart, apply the maximum available store credit, and open checkout. You review
and complete the order in the browser.

## Use the application

1. Open `dist\ShipMonitor\ShipMonitor.exe`. Keep the entire `ShipMonitor`
   folder together: it contains the app's private Java runtime.
2. Enter a check interval in seconds and paste the RSI shop URL.
3. Leave **Check sign-in before monitoring** selected and choose **Start
   monitoring**. Sign in in the browser window if prompted. The app waits for
   a recognizable signed-in account indicator before checking the ship, and
   checks again before adding it to the cart. Select **Stop monitoring** to stop.
   If the site changes and the app cannot recognize your sign-in, you can stop
   it and clear the checkbox to monitor without that verification.

The application attempts to show the image provided by the shop page. If the
page does not provide a usable image, the monitor can still check availability.
When the button becomes available, the app attempts to add the ship once,
select MAX and ADD under Add store credits, then proceed to checkout. It stops
monitoring there; it does not submit the order or payment. RSI warns that items obtained using store credit are non-giftable.
The app follows the MAX and ADD controls before continuing, without relying on
a particular confirmation message. If it cannot identify the next control,
it reports that your attention is needed and leaves the browser open. No sound
plays. The follow-up script has not yet been specified; see below.

The app uses the default browser selected in Windows. It supports Chromium-based
browsers such as Brave, Chrome, Edge, Vivaldi, and Opera; Firefox is not supported
by this automation. The app opens a separate temporary browser profile, so your
normal browser tabs and saved sign-in are not shared. The app automatically
accepts all cookies through RSI’s recognized cookie banner. Sign in in that
browser window if needed.
Keep the app open while reviewing checkout; closing it or starting a new session
closes the browser and removes the temporary profile. A page may still block automated checks; a blocked page,
ambiguous control, or obstructed button is reported as **UNKNOWN**, not as
available. Availability can change between checks, and a visible button does
not guarantee that checkout will succeed.

## Run a follow-up command

Start the app from PowerShell with `--on-available` followed by the program
and its arguments. For example, replace the program path with your own:

```powershell
& .\dist\ShipMonitor\ShipMonitor.exe --on-available 'C:\path\to\your-program.exe'
```

Everything after `--on-available` is passed as the command and its arguments;
the app does not automatically supply the shop URL. The command runs once
when availability is confirmed, not on an unavailable or unknown result.
Its completion or failure is shown in the app. The specified
program must be installed and accessible on the machine running the app.
The final command can be configured when the other script's details are known.

## Build and distribution

See [BUILDING.md](BUILDING.md) for building the JAR, Windows launcher with
bundled Java runtime, and optional installer.
