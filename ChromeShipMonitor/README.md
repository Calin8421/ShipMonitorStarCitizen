# Star Citizen Ship Monitor — Chrome extension

This extension monitors the RSI ship page in your current Chrome tab. It uses
the tab's existing RSI session. The cart must be empty before the extension
adds a ship. It attempts to add one ship, checks the ship and quantity, opens
Add store credits, selects MAX then ADD, and opens checkout. By default, you
review and submit the order yourself. If you explicitly enable automatic order
placement, it will also select Place order, check the agreement box and select
I agree. This accepts RSI's terms and may submit a binding pledge.

## Install locally

1. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
2. Select **Load unpacked**, then choose this `ChromeShipMonitor` folder.
3. Open and sign in to RSI, navigate to the ship's pledge page, and open the
   extension from Chrome's Extensions menu. Pin it if you like.
4. Set the interval in milliseconds and select **Start monitoring**. For
   example, 5000 milliseconds is 5 seconds. Keep that tab
   open. The page reloads at the chosen interval while it is monitoring. To
   place the order automatically, also select the automatic ordering checkbox.
   Select **Dry run** to open Place order and check the agreement checkbox, but
   stop before sending I agree. Dry run takes precedence over automatic ordering.

The optional sign-in check waits until the page shows a recognizable account
indicator. If you are already signed in but it cannot recognize your account,
stop monitoring and clear the checkbox. The existing cart must be empty; the
extension stops for review when it cannot verify exactly one matching ship.
Automatic order placement is limited to an amount due of zero, as verified on
the order page. The extension stops if it cannot read the total or the amount
is nonzero. It attempts Place order, the agreement checkbox, and final I agree
only once each. It watches for recognizable confirmation or error messages and
reports an unknown result if neither appears. Check RSI order history for the
final payment and fulfillment status.

Open **Activity log** in the popup to review up to 100 recent status changes
and actions attempted. The log resets when a new monitoring session starts or
Chrome closes. Order-result wording and dry-run behavior need a live RSI test;
a detected confirmation message does not by itself verify payment or fulfillment.

During checkout preparation, the extension checks progress roughly every
250 milliseconds. If the cart or checkout does not open, the credit section
remains closed, or MAX has not changed to ADD, it retries the control up to
three times. It presses ADD once, then proceeds to checkout without waiting for
credit confirmation. If a browser
click cannot be confirmed, the extension stops for review; it does not repeat
an uncertain Add to Cart press. Browser throttling and site response times can
delay checks, especially in background tabs.

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
