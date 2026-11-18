# Star Citizen Ship Monitor — Chrome extension

This extension monitors the RSI ship page in your current Chrome tab. It uses
the tab's existing RSI session. The cart must be empty before the extension
adds a ship. It attempts to add one ship, checks the ship and quantity, opens
Add store credits, selects MAX then ADD, and opens checkout. Review and submit
the order yourself; the extension does not submit payment.

## Install locally

1. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
2. Select **Load unpacked**, then choose this `ChromeShipMonitor` folder.
3. Open and sign in to RSI, navigate to the ship's pledge page, and open the
   extension from Chrome's Extensions menu. Pin it if you like.
4. Set the interval in milliseconds and select **Start monitoring**. For
   example, 5000 milliseconds is 5 seconds. Keep that tab
   open. The page reloads at the chosen interval while it is monitoring.

The optional sign-in check waits until the page shows a recognizable account
indicator. If you are already signed in but it cannot recognize your account,
stop monitoring and clear the checkbox. The existing cart must be empty; the
extension stops for review when it cannot verify exactly one matching ship.

Chrome shows a debugging notification when the extension sends browser input.
This permission lets it use browser-generated mouse events for controls that
do not respond to a JavaScript-only click. The extension requests access only
to RSI pages. It stores monitoring state in Chrome's session storage, which
is cleared when Chrome closes or the extension is reloaded. It does not send
data to a separate server. Chrome or RSI can change behavior, so test the flow
and review the cart and store credit before paying.

## Test

Run `node tests/background.cjs` and `node tests/content.cjs` from this folder
to check session isolation, the cart sequence and checkout stage guards. The
extension also needs a live signed-in RSI test.
