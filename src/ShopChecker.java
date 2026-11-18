import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Inspection and cart navigation in a private browser session. */
public final class ShopChecker implements AutoCloseable {
    public static final class CheckResult {
        public final String status, detail, imageUrl;
        public CheckResult(String status, String detail, String imageUrl) {
            this.status = status; this.detail = detail; this.imageUrl = imageUrl;
        }
    }

    private volatile boolean closed;
    private final boolean visible;
    private volatile Process browser;
    private volatile WebSocket socket;
    private Path profile;
    private boolean actionAttempted;
    private String inspectedUrl;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final AtomicInteger sequence = new AtomicInteger();
    private final Map<Integer, CompletableFuture<Map<String, Object>>> pending = new ConcurrentHashMap<>();

    public ShopChecker() { this(false); }
    public ShopChecker(boolean visible) { this.visible = visible; }

    public static void validateUrl(String value) {
        try {
            URI u = URI.create(value);
            String host = u.getHost();
            if (!"https".equalsIgnoreCase(u.getScheme()) || host == null || u.getUserInfo() != null ||
                !(host.equalsIgnoreCase("robertsspaceindustries.com") || host.equalsIgnoreCase("www.robertsspaceindustries.com")) ||
                (u.getPort() != -1 && u.getPort() != 443)) throw new IllegalArgumentException();
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Enter a valid https://robertsspaceindustries.com/ shop URL.");
        }
    }

    /** Open the product page once, then inspect the current browser tab without interrupting sign-in. */
    public CheckResult checkSignIn(String url) throws Exception {
        validateUrl(url);
        if (closed) throw new IOException("Monitor stopped.");
        if (socket == null) {
            try {
                startBrowser();
                Map<String, Object> navigation = command("Page.navigate", "{\"url\":" + quote(url) + "}", 10);
                Map<?, ?> result = (Map<?, ?>) navigation.get("result");
                if (result == null || result.get("errorText") != null)
                    throw new IOException("Could not open the shop page.");
                Thread.sleep(1500);
            } catch (Exception e) { stopBrowser(); throw e; }
        }
        Map<?, ?> result = evaluateAction(SIGN_IN_STATUS);
        if ("SIGNED_IN".equals(str(result.get("status")))) {
            Map<?, ?> location = evaluateAction(GUARD_NAVIGATION.replace("__EXPECTED_URL__", quote(url)));
            if (!"SAFE".equals(str(location.get("status")))) {
                Map<String, Object> navigation = command("Page.navigate", "{\"url\":" + quote(url) + "}", 10);
                Map<?, ?> navResult = (Map<?, ?>) navigation.get("result");
                if (navResult == null || navResult.get("errorText") != null)
                    return new CheckResult("UNKNOWN", "Signed in, but could not return to the product page.", "");
                Thread.sleep(1500);
            }
        }
        return new CheckResult(str(result.get("status")), str(result.get("detail")), "");
    }

    public CheckResult check(String url) throws Exception {
        validateUrl(url);
        inspectedUrl = null;
        if (closed) throw new IOException("Monitor stopped.");
        if (socket == null) {
            try { startBrowser(); }
            catch (Exception e) { stopBrowser(); throw e; }
        }
        // Never refresh away a sign-in or other page the user opened in this session.
        Map<?, ?> guard = evaluateAction(GUARD_NAVIGATION.replace("__EXPECTED_URL__", quote(url)));
        if (!"SAFE".equals(str(guard.get("status"))))
            return new CheckResult("UNKNOWN", str(guard.get("detail")), "");
        // Clear the previous document first, so a failed navigation can never report stale availability.
        command("Page.navigate", "{\"url\":\"about:blank\"}", 10);
        boolean cleared = false;
        for (int i = 0; i < 30 && !closed; i++) {
            try {
                Map<String, Object> r = command("Runtime.evaluate", "{\"expression\":\"location.href\",\"returnByValue\":true}", 5);
                Map<?, ?> outer = (Map<?, ?>) r.get("result");
                Map<?, ?> inner = outer == null ? null : (Map<?, ?>) outer.get("result");
                if (inner != null && "about:blank".equals(inner.get("value"))) { cleared = true; break; }
            } catch (IOException ignored) { }
            Thread.sleep(100);
        }
        if (!cleared) throw new IOException("Could not prepare a fresh page for this check.");
        Map<String, Object> navigation = command("Page.navigate", "{\"url\":" + quote(url) + "}", 10);
        Map<?, ?> navResult = (Map<?, ?>) navigation.get("result");
        if (navResult == null || navResult.get("errorText") != null) throw new IOException("Page navigation failed: " + (navResult == null ? "no result" : navResult.get("errorText")));
        // The navigation may replace its JS context; wait for the new document and retry if needed.
        Thread.sleep(2000);
        Exception last = null;
        for (int attempt = 0; attempt < 3 && !closed; attempt++) {
            try {
                Map<String, Object> result = command("Runtime.evaluate", "{\"expression\":" + quote(INSPECT) +
                    ",\"awaitPromise\":true,\"returnByValue\":true}", 25);
                Map<?, ?> envelope = (Map<?, ?>) result.get("result");
                if (envelope == null || envelope.get("exceptionDetails") != null) throw new IOException("Page inspection failed.");
                Map<?, ?> remote = (Map<?, ?>) envelope.get("result");
                if (remote == null || !(remote.get("value") instanceof String)) throw new IOException("Page inspection returned no result.");
                Map<?, ?> value = (Map<?, ?>) Json.parse((String) remote.get("value"));
                String status = str(value.get("status"));
                if (!"AVAILABLE".equals(status) && !"UNAVAILABLE".equals(status)) status = "UNKNOWN";
                if ("AVAILABLE".equals(status)) inspectedUrl = url;
                return new CheckResult(status, str(value.get("detail")), str(value.get("image")));
            } catch (Exception e) {
                last = e;
                if (!closed) Thread.sleep(1000);
            }
        }
        throw new IOException("Could not inspect the page. " + (last == null ? "" : last.getMessage()), last);
    }

    /** Add the inspected product once and advance through the observed RSI cart flow. */
    public CheckResult addToCartAndCheckout() throws Exception {
        return addToCartAndCheckout(message -> {});
    }

    public CheckResult addToCartAndCheckout(java.util.function.Consumer<String> progress) throws Exception {
        if (inspectedUrl == null)
            return new CheckResult("NEEDS_ATTENTION", "Check the product before opening checkout.", "");
        if (actionAttempted)
            return new CheckResult("NEEDS_ATTENTION", "An add-to-cart attempt was already made. Check the browser.", "");
        actionAttempted = true;
        Map<?, ?> initial = evaluateAction(CLICK_CART.replace("__EXPECTED_URL__", quote(inspectedUrl)));
        if (!"READY".equals(str(initial.get("status"))))
            return new CheckResult("NEEDS_ATTENTION", str(initial.get("detail")), "");
        String product = str(initial.get("product"));
        if (!(initial.get("count") instanceof Number) || product.isBlank())
            return new CheckResult("NEEDS_ATTENTION", "Could not identify the item or cart count. Continue in the browser.", "");
        int previousCount = ((Number) initial.get("count")).intValue();
        try { dispatchBrowserClick(initial); }
        catch (Exception e) {
            return new CheckResult("NEEDS_ATTENTION", "The add-to-cart result is uncertain. Check the browser before trying again.", "");
        }

        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(90);
        int stage = 0; // 0: cart icon, 1: credit section, 2: MAX, 3: ADD, 4: continue, 5: checkout
        String lastProgress = "";
        int creditOpenAttempts = 0;
        while (!closed && System.nanoTime() < end) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException("Monitor stopped.");
            Map<?, ?> step;
            try {
                String script = RSI_CART_STEP.replace("__COUNT__", Integer.toString(previousCount))
                        .replace("__PRODUCT__", quote(product)).replace("__STAGE__", Integer.toString(stage));
                step = evaluateAction(script);
            } catch (InterruptedException e) {
                throw e;
            } catch (Exception e) {
                // Navigation can replace the JavaScript context. Read-only checks may safely retry.
                Thread.sleep(500);
                continue;
            }
            String state = str(step.get("status"));
            String detail = str(step.get("detail"));
            if ("WAIT".equals(state) && !detail.isBlank() && !detail.equals(lastProgress)) {
                lastProgress = detail;
                progress.accept(detail);
            }
            if ("CHECKOUT".equals(state))
                return new CheckResult("CHECKOUT", "Checkout is open. Review the cart and complete the order in the browser.", "");
            if ("NEEDS_ATTENTION".equals(state))
                return new CheckResult("NEEDS_ATTENTION", str(step.get("detail")), "");
            int nextStage = -1;
            if ("OPEN_CART".equals(state) && stage == 0) nextStage = 1;
            else if ("OPEN_CREDITS".equals(state) && (stage == 1 || stage == 2)) {
                if (++creditOpenAttempts > 3)
                    return new CheckResult("NEEDS_ATTENTION", "Could not open Add store credits. Open it in the browser and try again.", "");
                nextStage = 2;
            }
            else if ("MAX_CREDITS".equals(state) && (stage == 1 || stage == 2)) nextStage = 3;
            else if ("ADD_CREDITS".equals(state) && stage == 3) nextStage = 4;
            else if ("OPEN_CHECKOUT".equals(state) && stage == 4) nextStage = 5;
            if (nextStage != -1) {
                String[] messages = {"Waiting for the cart.", "Opening the cart.", "Opening store credits.", "Selecting maximum store credit.", "Applying store credit.", "Opening checkout."};
                lastProgress = messages[nextStage];
                progress.accept(lastProgress);
                // Record the next stage before dispatching, so a lost response cannot repeat a click.
                stage = nextStage;
                try { dispatchBrowserClick(step); }
                catch (Exception e) {
                    return new CheckResult("NEEDS_ATTENTION", "The last cart action may have happened. Check the browser before continuing.", "");
                }
                end = System.nanoTime() + TimeUnit.SECONDS.toNanos(90);
                if ("OPEN_CREDITS".equals(state) || "ADD_CREDITS".equals(state)) Thread.sleep(2000);
            }
            Thread.sleep(500);
        }
        return new CheckResult("NEEDS_ATTENTION", (lastProgress.isBlank() ? "Could not find the next cart control." : lastProgress) + " Check the browser before continuing.", "");
    }

    /** Send browser input through DevTools; it does not move the system mouse. */
    private void dispatchBrowserClick(Map<?, ?> target) throws Exception {
        if (!(target.get("x") instanceof Number) || !(target.get("y") instanceof Number))
            throw new IOException("Button position was unavailable.");
        double x = ((Number) target.get("x")).doubleValue();
        double y = ((Number) target.get("y")).doubleValue();
        String position = "\"x\":" + x + ",\"y\":" + y;
        command("Input.dispatchMouseEvent", "{\"type\":\"mouseMoved\"," + position + "}", 5);
        command("Input.dispatchMouseEvent", "{\"type\":\"mousePressed\",\"button\":\"left\",\"clickCount\":1," + position + "}", 5);
        command("Input.dispatchMouseEvent", "{\"type\":\"mouseReleased\",\"button\":\"left\",\"clickCount\":1," + position + "}", 5);
    }

    private Map<?, ?> evaluateAction(String script) throws Exception {
        if (closed || Thread.currentThread().isInterrupted()) throw new InterruptedException("Monitor stopped.");
        Map<String, Object> result = command("Runtime.evaluate", "{\"expression\":" + quote(script) + ",\"returnByValue\":true}", 10);
        Map<?, ?> envelope = (Map<?, ?>) result.get("result");
        if (envelope == null || envelope.get("exceptionDetails") != null) throw new IOException("Browser action failed.");
        Map<?, ?> remote = (Map<?, ?>) envelope.get("result");
        if (remote == null || !(remote.get("value") instanceof String)) throw new IOException("Browser action returned no result.");
        Object value = Json.parse((String) remote.get("value"));
        if (!(value instanceof Map)) throw new IOException("Browser action returned an invalid result.");
        return (Map<?, ?>) value;
    }


    private void startBrowser() throws Exception {
        Path executable = findBrowser();
        if (executable == null) throw new IOException("Could not find your default browser in Windows settings.");
        int port;
        try (ServerSocket s = new ServerSocket()) {
            s.bind(new InetSocketAddress("127.0.0.1", 0)); port = s.getLocalPort();
        }
        profile = Files.createTempDirectory("ship-monitor-browser-");
        if (closed) throw new IOException("Monitor stopped.");
        List<String> args = new ArrayList<>();
        args.add(executable.toString());
        if (!visible) args.add("--headless=new");
        args.add("--disable-gpu"); args.add("--no-first-run"); args.add("--no-default-browser-check");
        args.add("--remote-debugging-address=127.0.0.1"); args.add("--remote-debugging-port=" + port);
        args.add("--user-data-dir=" + profile.toAbsolutePath()); args.add("about:blank");
        browser = new ProcessBuilder(args).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        if (closed) { browser.destroyForcibly(); throw new IOException("Monitor stopped."); }
        URI endpoint = URI.create("http://127.0.0.1:" + port + "/json/list");
        Exception last = null;
        for (int i = 0; i < 50 && !closed; i++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(2)).GET().build();
                HttpResponse<String> response = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) throw new IOException("Browser setup returned " + response.statusCode());
                Object parsed = Json.parse(response.body());
                if (!(parsed instanceof List<?>)) throw new IOException("Browser did not return a tab list.");
                Map<?, ?> target = null;
                for (Object entry : (List<?>) parsed) {
                    if (entry instanceof Map<?, ?> && "page".equals(((Map<?, ?>) entry).get("type"))) {
                        target = (Map<?, ?>) entry;
                        if ("about:blank".equals(target.get("url"))) break;
                    }
                }
                if (target == null) throw new IOException("Browser tab is not ready yet.");
                if (visible && target.get("id") != null) {
                    HttpRequest activate = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/json/activate/" + target.get("id"))).timeout(Duration.ofSeconds(2)).GET().build();
                    http.send(activate, HttpResponse.BodyHandlers.discarding());
                }
                URI ws = URI.create(str(target.get("webSocketDebuggerUrl")));
                socket = http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5)).buildAsync(ws, new Listener()).get(6, TimeUnit.SECONDS);
                if (closed) { socket.abort(); throw new IOException("Monitor stopped."); }
                return;
            } catch (Exception e) { last = e; Thread.sleep(200); }
        }
        throw new IOException("Could not start the browser. " + (last == null ? "" : last.getMessage()), last);
    }

    private static Path findBrowser() throws IOException, InterruptedException {
        String override = System.getProperty("shipmonitor.browser");
        if (override != null && Files.isRegularFile(Paths.get(override))) return Paths.get(override);
        String progId = registryValue("HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "ProgId");
        if (progId == null || !progId.matches("[A-Za-z0-9_.-]+"))
            throw new IOException("Could not read the Windows default browser setting. Set a default browser in Windows settings.");
        String openCommand = registryValue("HKCR\\" + progId + "\\shell\\open\\command", "");
        if (openCommand == null) throw new IOException("Could not find the default browser executable for " + progId + ".");
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("^\\s*(?:\"([^\"]+\\.exe)\"|(.+?\\.exe))", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(openCommand);
        if (!matcher.find()) throw new IOException("Could not interpret the default browser command.");
        String executable = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
        java.util.regex.Matcher variable = java.util.regex.Pattern.compile("%([^%]+)%").matcher(executable);
        StringBuffer expanded = new StringBuffer();
        while (variable.find()) {
            String value = System.getenv(variable.group(1));
            variable.appendReplacement(expanded, java.util.regex.Matcher.quoteReplacement(value == null ? variable.group() : value));
        }
        variable.appendTail(expanded);
        Path path = Paths.get(expanded.toString());
        String name = path.getFileName().toString().toLowerCase(Locale.ROOT);
        if (!List.of("brave.exe", "chrome.exe", "msedge.exe", "chromium.exe", "vivaldi.exe", "opera.exe").contains(name))
            throw new IOException("Your default browser (" + name + ") is not supported. Choose a Chromium-based browser in Windows settings.");
        if (!Files.isRegularFile(path)) throw new IOException("The default browser executable was not found: " + path);
        return path;
    }

    private static String registryValue(String key, String valueName) throws IOException, InterruptedException {
        List<String> args = new ArrayList<>(List.of("reg.exe", "query", key));
        if (valueName.isEmpty()) args.add("/ve"); else { args.add("/v"); args.add(valueName); }
        Process process = new ProcessBuilder(args).redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes(), java.nio.charset.Charset.defaultCharset());
        if (!process.waitFor(5, TimeUnit.SECONDS) || process.exitValue() != 0) return null;
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("(?m)\\bREG_(?:EXPAND_)?SZ\\s+([^\\r\\n]+)").matcher(output);
        return matcher.find() ? matcher.group(1).trim() : null;
    }

    private Map<String, Object> command(String method, String params, int timeout) throws Exception {
        if (closed || socket == null) throw new IOException("Browser is closed.");
        int id = sequence.incrementAndGet();
        CompletableFuture<Map<String, Object>> future = new CompletableFuture<>();
        pending.put(id, future);
        try {
            socket.sendText("{\"id\":" + id + ",\"method\":" + quote(method) + ",\"params\":" + params + "}", true).get(5, TimeUnit.SECONDS);
            Map<String, Object> response = future.get(timeout, TimeUnit.SECONDS);
            if (response.containsKey("error")) throw new IOException("Browser error: " + response.get("error"));
            return response;
        } finally { pending.remove(id); }
    }

    private final class Listener implements WebSocket.Listener {
        private final StringBuilder buffer = new StringBuilder();
        public void onOpen(WebSocket ws) { ws.request(1); }
        @SuppressWarnings("unchecked") public java.util.concurrent.CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                try {
                    Map<String, Object> response = (Map<String, Object>) Json.parse(buffer.toString());
                    Object id = response.get("id");
                    if (id instanceof Number) {
                        CompletableFuture<Map<String, Object>> f = pending.get(((Number) id).intValue());
                        if (f != null) f.complete(response);
                    }
                } catch (RuntimeException ignored) { }
                buffer.setLength(0);
            }
            ws.request(1); return null;
        }
        public void onError(WebSocket ws, Throwable error) { pending.values().forEach(f -> f.completeExceptionally(error)); }
    }

    public void close() {
        closed = true;
        pending.values().forEach(f -> f.completeExceptionally(new IOException("Monitor stopped.")));
        stopBrowser();
    }

    private void stopBrowser() {
        WebSocket s = socket; socket = null; if (s != null) s.abort();
        Process p = browser; browser = null;
        if (p != null) {
            p.descendants().forEach(ProcessHandle::destroyForcibly);
            p.destroyForcibly();
            try { p.waitFor(3, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        Path dir = profile; profile = null;
        if (dir != null && Files.exists(dir)) {
            try (java.util.stream.Stream<Path> paths = Files.walk(dir)) {
                paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> { try { Files.deleteIfExists(path); } catch (IOException ignored) { } });
            } catch (IOException ignored) { }
        }
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }
    private static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break; case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break; case '\r': b.append("\\r"); break; case '\t': b.append("\\t"); break;
                default: if (c < 32) b.append(String.format(Locale.ROOT, "\\u%04x", (int)c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private static final String INSPECT = "(async () => {" +
        "window.__shipMonitorTarget=null;window.__shipMonitorUrl=null;" +
        "const visible=e=>{for(let p=e;p;p=p.parentElement){let s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}let r=e.getBoundingClientRect();return r.width>0&&r.height>0;};" +
        "const candidates=()=>[...document.querySelectorAll('button,a,[role=button],[role=link],input[type=submit],input[type=button]')].filter(e=>/\\badd\\s+to\\s+cart\\b/i.test(e.getAttribute('aria-label')||e.value||e.innerText||'')&&visible(e));" +
        "let cookieClicked=false;" +
        "for(let i=0;i<40;i++){" +
        "let cookie=document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');" +
        "if(!cookieClicked&&cookie&&visible(cookie)&&!cookie.disabled){cookieClicked=true;cookie.click();await new Promise(r=>setTimeout(r,500));continue;}" +
        "let found=candidates();if(found.length>1)break;" +
        "if(found.length===1&&i>=4){let e=found[0];if(e.matches(':disabled')||e.getAttribute('aria-disabled')==='true'||e.closest('[aria-disabled=true]'))break;" +
        "e.scrollIntoView({block:'center',inline:'center'});let r=e.getBoundingClientRect(),t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);" +
        "if(t&&(t===e||e.contains(t))&&getComputedStyle(e).pointerEvents!=='none')break;}" +
        "await new Promise(r=>setTimeout(r,500));}" +
        "let image=document.querySelector('meta[property=\"og:image\"]')?.content||document.querySelector('meta[name=\"twitter:image\"]')?.content||'';" +
        "try{if(image)image=new URL(image,location.href).href}catch(e){image=''};" +
        "let c=candidates(),status='UNKNOWN',detail='No recognizable visible Add to Cart control; the page may be loading, sold out, or blocked.';" +
        "if(c.length>1)detail='Multiple Add to Cart controls found; cannot identify the target reliably.';" +
        "else if(c.length===1){let e=c[0];if(e.matches(':disabled')||e.getAttribute('aria-disabled')==='true'||e.closest('[aria-disabled=true]')){status='UNAVAILABLE';detail='The Add to Cart control is disabled.';}" +
        "else{e.scrollIntoView({block:'center',inline:'center'});let r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,t=document.elementFromPoint(x,y);" +
        "if(t&&(t===e||e.contains(t))&&getComputedStyle(e).pointerEvents!=='none'){status='AVAILABLE';detail='The Add to Cart control is visible, enabled, and unobstructed.';window.__shipMonitorTarget=e;window.__shipMonitorUrl=location.href;}" +
        "else detail='The control is not actionable; an overlay or loading state may be blocking it.';}}" +
        "return JSON.stringify({status,detail,image});})()";

    private static final String ACTION_HELPERS =
        "const allowed=()=>location.protocol==='https:'&&['robertsspaceindustries.com','www.robertsspaceindustries.com'].includes(location.hostname.toLowerCase())&&(!location.port||location.port==='443');" +
        "const visible=e=>{for(let p=e;p;p=p.parentElement){let s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}let r=e.getBoundingClientRect();return r.width>0&&r.height>0;};" +
        "const actionable=e=>{if(!e||!visible(e)||e.matches(':disabled')||e.getAttribute('aria-disabled')==='true'||e.closest('[aria-disabled=true]')||getComputedStyle(e).pointerEvents==='none')return false;e.scrollIntoView({block:'center',inline:'center'});let r=e.getBoundingClientRect(),t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!t&&(t===e||e.contains(t));};" +
        "const controls=()=>[...document.querySelectorAll('button,a,[role=button],[role=link],input[type=submit],input[type=button]')];" +
        "const label=e=>(e.getAttribute('aria-label')||e.value||e.innerText||'').trim().replace(/\\s+/g,' ');" +
        "const out=(status,detail='')=>JSON.stringify({status,detail});";
    private static final String CLICK_CART = "(()=>{" + ACTION_HELPERS +
        "let expected=new URL(__EXPECTED_URL__);let norm=p=>p.replace(/\\/+$/,'');" +
        "if(!allowed()||location.href!==window.__shipMonitorUrl||location.hostname.toLowerCase().replace(/^www\\./,'')!==expected.hostname.toLowerCase().replace(/^www\\./,'')||norm(location.pathname)!==norm(expected.pathname)||(expected.search&&location.search!==expected.search))return out('NEEDS_ATTENTION','The browser is no longer on the requested product page.');" +
        "let c=controls().filter(e=>/\\badd\\s+to\\s+cart\\b/i.test(label(e))&&visible(e));let e=window.__shipMonitorTarget;" +
        "if(c.length!==1||c[0]!==e||!actionable(e))return out('NEEDS_ATTENTION','The product button changed or is blocked; check the browser.');" +
        "let badge=document.querySelector('#platform-bar-cart-icon .a-ticker__endValue');let count=badge?parseInt(badge.innerText,10):0;" +
        "let title=document.title||'', titleMatch=title.match(/^Buy\\s+(.+?)\\s+-\\s+(?:Standalone|Ship|Pledge)/i);" +
        "let product=(titleMatch?titleMatch[1]:document.querySelector('h1')?.innerText||title.replace(/^Buy\\s+/i,'').split(' | ')[0]).trim();" +
        "if(!Number.isFinite(count))return out('NEEDS_ATTENTION','Could not read the cart count.');" +
        "let r=e.getBoundingClientRect();window.__shipMonitorTarget=null;return JSON.stringify({status:'READY',x:r.left+r.width/2,y:r.top+r.height/2,count,product});})()";
    private static final String RSI_CART_STEP = "(()=>{" + ACTION_HELPERS +
        "if(!allowed())return out('NEEDS_ATTENTION','The browser left the shop. Check it to continue.');" +
        "if(/\\/(?:login|sign-in|signin)(?:\\/|$)/i.test(location.pathname)||[...document.querySelectorAll('input[type=password]')].some(visible))return out('NEEDS_ATTENTION','Sign in and continue in the browser.');" +
        "if(/\\/checkout(?:\\/|$)/i.test(location.pathname))return __STAGE__===5?out('CHECKOUT'):out('NEEDS_ATTENTION','Checkout opened before store credit was confirmed. Check the browser.');" +
        "let cartPage=/\\/(?:cart|shopping-cart)(?:\\/|$)/i.test(location.pathname);" +
        "const ready=(status,e)=>{if(!actionable(e))return out('WAIT');let r=e.getBoundingClientRect();return JSON.stringify({status,x:r.left+r.width/2,y:r.top+r.height/2});};" +
        "if(__STAGE__===0){let badge=document.querySelector('#platform-bar-cart-icon .a-ticker__endValue');let count=badge?parseInt(badge.innerText,10):0;" +
        "if(Number.isFinite(count)&&count>__COUNT__){let e=document.querySelector('#platform-bar-cart-icon');return ready('OPEN_CART',e);}return out('WAIT','Waiting for the cart to update.');}" +
        "if(__STAGE__>=1&&__STAGE__<=4&&cartPage){" +
        "const norm=s=>String(s||'').replace(/\\u00a0/g,' ').replace(/\\s+/g,' ').trim().toLowerCase();" +
        "let body=document.body?.innerText||'';" +
        "let badge=document.querySelector('#platform-bar-cart-icon .a-ticker__endValue');" +
        "let count=badge?parseInt(badge.innerText,10):NaN;" +
        "if(!Number.isFinite(count)||count<=__COUNT__)return out('WAIT','Waiting for the added item to appear in the cart.');" +
        "let items=[...document.querySelectorAll('[class*=cartLineItem i],[data-cy-id*=cartLineItem i]')].filter(visible);" +
        "let hasItem=items.some(e=>norm(e.innerText).length>0);" +
        "let countText=body.match(/items\\s+in\\s+your\\s+cart\\s*\\[?\\s*(\\d+)\\s*\\]?/i)||body.match(/shopping\\s+bag\\s*(\\d+)\\s*items?/i);" +
        "if(!hasItem&&!(countText&&Number(countText[1])>0))return out('WAIT','Waiting for the cart items to load.');" +
        "let possible=[...new Set([...controls(),...document.querySelectorAll('[data-cy-id=__row],.m-summaryUnit__row')])];" +
        "let headers=possible.filter(e=>visible(e)&&(/^add store credits?$/i.test(label(e))||/^add store credits?$/i.test(norm(e.innerText))));" +
        "if(headers.length>1)return out('NEEDS_ATTENTION','Multiple store credit sections found. Continue in the browser.');" +
        "let header=headers[0];" +
        "if(__STAGE__===1||__STAGE__===2||__STAGE__===3){if(!header)return out('WAIT','Looking for the Add store credits section.');" +
        "let wanted=__STAGE__===3?'ADD':'MAX', area=header.parentElement,sawInput=false;" +
        "for(let i=0;area&&i<9;i++,area=area.parentElement){let inputs=[...area.querySelectorAll('input')].filter(visible);if(inputs.length)sawInput=true;" +
        "let found=[...area.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit],[tabindex],span,div')].filter(e=>visible(e)&&(label(e).toUpperCase()===wanted||norm(e.innerText).toUpperCase()===wanted));" +
        "let matches=[...new Set(found.map(e=>{let target=e.closest('button,a,[role=button],input[type=button],input[type=submit],[tabindex]');return target&&area.contains(target)?target:e;}))];" +
        "matches=matches.filter(e=>!matches.some(other=>other!==e&&e.contains(other)));" +
        "if(inputs.length&&matches.length){if(matches.length>1)return out('NEEDS_ATTENTION','Multiple '+wanted+' controls found near store credits.');" +
        "if(__STAGE__===3){let amount=inputs.map(e=>parseFloat(String(e.value||'').replace(/[^0-9.]/g,''))).find(n=>Number.isFinite(n)&&n>0);if(!amount)return out('WAIT','Waiting for the maximum credit amount.');}" +
        "return ready(__STAGE__===3?'ADD_CREDITS':'MAX_CREDITS',matches[0]);}}" +
        "if((__STAGE__===1||__STAGE__===2)&&header.getAttribute('aria-expanded')!=='true'&&!sawInput){" +
        "let arrow=header.querySelector?.('[data-cy-id*=chevron i],[class*=chevron i],svg');" +
        "return ready('OPEN_CREDITS',arrow&&visible(arrow)&&actionable(arrow)?arrow:header);}" +
        "return out('WAIT',__STAGE__===3?'Waiting for the ADD store credit button.':'Waiting for the MAX store credit button.');}" +
        "if(__STAGE__===4){" +
        "let c=controls().filter(e=>visible(e)&&/^(?:(?:proceed|continue|go) to )?checkout$/i.test(label(e)));" +
        "if(c.length>1)return out('NEEDS_ATTENTION','Multiple checkout controls found. Continue in the browser.');" +
        "if(c.length===1)return ready('OPEN_CHECKOUT',c[0]);return out('WAIT','Waiting for Continue to checkout.');}}" +
        "if(__STAGE__===5&&cartPage){let dialogs=[...document.querySelectorAll('[role=dialog],dialog,[aria-modal=true]')].filter(visible);if(dialogs.some(d=>/sign[ -]?in|log[ -]?in/i.test(d.innerText||''))||[...document.querySelectorAll('input[type=password]')].some(visible))return out('NEEDS_ATTENTION','Sign in and continue in the browser.');" +
        "if(controls().some(e=>visible(e)&&/^(?:proceed to pay|continue to payment|add (?:a |an )?address)$/i.test(label(e))))return out('CHECKOUT');}" +
        "return out('WAIT');})()";
    private static final String SIGN_IN_STATUS = "(()=>{" + ACTION_HELPERS +
        "if(!allowed())return out('UNKNOWN','Finish signing in in the browser and return to the RSI shop.');" +
        "let cookie=document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');" +
        "if(cookie&&visible(cookie)&&!cookie.disabled)cookie.click();" +
        "if([...document.querySelectorAll('input[type=password]')].some(visible))return out('SIGNED_OUT','Finish signing in in the browser.');" +
        "let elements=[...document.querySelectorAll('button,a,[role=button]')].filter(visible);" +
        "if(elements.some(e=>/^(?:sign[ -]?in|log[ -]?in)$/i.test(label(e))))return out('SIGNED_OUT','Sign in in the browser to start monitoring.');" +
        "if(elements.some(e=>/^(?:sign[ -]?out|log[ -]?out)$/i.test(label(e))))return out('SIGNED_IN','Signed in. Monitoring will begin.');" +
        "let cart=document.querySelector('#platform-bar-cart-icon'),toolbar=cart?.parentElement;" +
        "if(toolbar&&[...toolbar.querySelectorAll('[class*=avatar i],[data-cy-id*=avatar i]')].some(visible))return out('SIGNED_IN','Signed in. Monitoring will begin.');" +
        "if(toolbar&&[...toolbar.querySelectorAll('button[aria-label],[role=button][aria-label]')].filter(visible).some(e=>/^(?:my account|account menu|profile menu)$/i.test(e.getAttribute('aria-label')||'')))return out('SIGNED_IN','Signed in. Monitoring will begin.');" +
        "return out('UNKNOWN','Could not verify sign-in yet. Sign in in the browser and return to the shop.');})()";
    private static final String GUARD_NAVIGATION = "(()=>{" + ACTION_HELPERS +
        "if(location.href==='about:blank')return out('SAFE');" +
        "let expected=new URL(__EXPECTED_URL__),norm=p=>p.replace(/\\/+$/,'');" +
        "if(!allowed()||location.hostname.toLowerCase().replace(/^www\\./,'')!==expected.hostname.toLowerCase().replace(/^www\\./,'')||norm(location.pathname)!==norm(expected.pathname))return out('BUSY','The browser is on another page. Finish signing in or return to the product page to resume monitoring.');" +
        "if([...document.querySelectorAll('input[type=password]')].some(visible))return out('BUSY','Finish signing in before monitoring resumes.');" +
        "return out('SAFE');})()";

    /** Minimal JSON reader for browser protocol messages. */
    private static final class Json {
        private final String s; private int i;
        private Json(String s) { this.s = s; }
        static Object parse(String s) { return new Json(s).read(); }
        private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
        private Object read() {
            ws(); if (i >= s.length()) throw new IllegalArgumentException("Invalid JSON"); char c = s.charAt(i);
            if (c == '"') return string();
            if (c == '{') { i++; Map<String,Object> m = new HashMap<>(); ws(); if (s.charAt(i)=='}') { i++; return m; }
                while (true) { ws(); String k = string(); ws(); if (s.charAt(i++) != ':') throw new IllegalArgumentException(); m.put(k, read()); ws(); char end=s.charAt(i++); if(end=='}')return m; if(end!=',')throw new IllegalArgumentException(); } }
            if (c == '[') { i++; List<Object> a=new ArrayList<>(); ws(); if(s.charAt(i)==']'){i++;return a;} while(true){a.add(read());ws();char end=s.charAt(i++);if(end==']')return a;if(end!=',')throw new IllegalArgumentException();} }
            if (s.startsWith("true",i)) {i+=4;return Boolean.TRUE;} if(s.startsWith("false",i)){i+=5;return Boolean.FALSE;} if(s.startsWith("null",i)){i+=4;return null;}
            int start=i; while(i<s.length() && "-+0123456789.eE".indexOf(s.charAt(i))>=0)i++; if(start==i)throw new IllegalArgumentException("Invalid JSON"); return Double.valueOf(s.substring(start,i));
        }
        private String string() { if(s.charAt(i++)!='"')throw new IllegalArgumentException(); StringBuilder b=new StringBuilder(); while(i<s.length()) { char c=s.charAt(i++); if(c=='"')return b.toString(); if(c=='\\'){c=s.charAt(i++); switch(c){case '"':case '\\':case '/':b.append(c);break;case 'b':b.append('\b');break;case 'f':b.append('\f');break;case 'n':b.append('\n');break;case 'r':b.append('\r');break;case 't':b.append('\t');break;case 'u':b.append((char)Integer.parseInt(s.substring(i,i+4),16));i+=4;break;default:throw new IllegalArgumentException();}}else b.append(c);}throw new IllegalArgumentException(); }
    }
}
