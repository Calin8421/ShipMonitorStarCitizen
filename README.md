# Star Citizen Ship Monitor

A Chrome extension that monitors the RSI ship page open in your current tab.
It uses your existing browser session and does not require a Java installation.

When the ship becomes available, the extension attempts to add one ship to an
empty cart, verify the ship and its quantity, apply the maximum available store
credit, and open checkout. You review the cart and complete the order yourself.

## Install in Chrome

1. Download or clone this repository and extract it if necessary.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the `ChromeShipMonitor` folder inside the
   repository. Select the folder containing `manifest.json`.
4. Open Chrome's Extensions menu and pin **Star Citizen Ship Monitor** if you
   want quick access to it.

## Use

1. Sign in to RSI and make sure your cart is empty.
2. Open the shop page for the ship you want to monitor.
3. Open the extension, set the check interval in milliseconds, and click
   **Start monitoring**. The default, `5000`, means five seconds.
4. Keep the tab open. The extension reloads the ship page at the chosen
   interval while checking availability.
5. When checkout opens, review the ship, quantity, store credit, and total
   before completing the order.

Use **Stop monitoring** to stop the extension. The optional sign-in check waits
for a recognizable account indicator; if it cannot recognize your signed-in
session, stop monitoring and clear the checkbox before starting again.

The extension stops for review if the cart is not empty before adding, if it
cannot verify one matching ship with quantity one, or if it cannot identify a
required cart control. Changes to RSI's website can affect the automation.

## Permissions and privacy

The extension requests access to RSI pages and uses Chrome's debugger
permission to send browser-generated input events. Chrome may show a debugging
notification while an action is being performed. Monitoring state is stored in
Chrome's session storage and is cleared when Chrome closes or the extension is
reloaded. The extension does not send information to a separate server.

## Development

The extension files are in [`ChromeShipMonitor`](ChromeShipMonitor/). To run the
automated checks, install Node.js and run:

```sh
cd ChromeShipMonitor
node tests/background.cjs
node tests/content.cjs
```

The automated checks use simulated browser and cart states. Verify the flow in
a signed-in RSI cart before relying on it.
