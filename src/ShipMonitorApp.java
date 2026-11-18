import java.awt.*;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.imageio.ImageIO;
import javax.swing.*;
import javax.swing.border.EmptyBorder;

/** Desktop front end for the RSI ship availability monitor. */
public final class ShipMonitorApp extends JFrame {
    private static final Color BACKGROUND = new Color(16, 23, 34);
    private static final Color PANEL = new Color(25, 36, 51);
    private static final Color TEXT = new Color(234, 241, 247);
    private static final Color MUTED = new Color(161, 177, 192);
    private static final Color ACCENT = new Color(54, 180, 190);
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss");

    private final JTextField interval = new JTextField("300");
    private final JTextField shopUrl = new JTextField();
    private final JCheckBox requireSignIn = new JCheckBox("Check sign-in before monitoring", true);
    private final JLabel image = new JLabel("Ship image will appear here", SwingConstants.CENTER);
    private final JLabel activity = new JLabel("INACTIVE");
    private final JLabel result = new JLabel("Ready to monitor");
    private final JTextArea detail = new JTextArea("Enter a shop URL and start monitoring.", 2, 38);
    private final JButton toggle = new JButton("Start monitoring");
    private final List<String> onAvailable;
    private Session session;

    private static final class Session {
        final AtomicBoolean running = new AtomicBoolean(true);
        final ShopChecker checker;
        Thread worker;

        Session(boolean visible) { checker = new ShopChecker(visible); }
    }

    public ShipMonitorApp(List<String> onAvailable) {
        super("Star Citizen Ship Monitor");
        this.onAvailable = onAvailable;
        setDefaultCloseOperation(WindowConstants.DO_NOTHING_ON_CLOSE);
        addWindowListener(new WindowAdapter() {
            @Override public void windowClosing(WindowEvent event) {
                stopMonitoring(false);
                dispose();
            }
        });
        setMinimumSize(new Dimension(720, 470));
        setSize(820, 510);
        setLocationRelativeTo(null);
        setContentPane(buildContent());
        toggle.addActionListener(event -> {
            if (session != null && session.running.get()) stopMonitoring(true);
            else startMonitoring();
        });
    }

    private JPanel buildContent() {
        JPanel root = new JPanel(new BorderLayout(0, 24));
        root.setBackground(BACKGROUND);
        root.setBorder(new EmptyBorder(30, 32, 28, 32));

        JPanel header = new JPanel(new BorderLayout());
        header.setOpaque(false);
        JLabel eyebrow = label("STAR CITIZEN  /  SHIP MONITOR", 11, Font.BOLD, ACCENT);
        JLabel title = label("Watch your ship", 26, Font.BOLD, TEXT);
        JPanel heading = new JPanel(new GridLayout(2, 1, 0, 3));
        heading.setOpaque(false);
        heading.add(eyebrow);
        heading.add(title);
        header.add(heading, BorderLayout.WEST);
        root.add(header, BorderLayout.NORTH);

        JPanel center = new JPanel(new BorderLayout(24, 0));
        center.setOpaque(false);
        image.setPreferredSize(new Dimension(270, 255));
        image.setOpaque(true);
        image.setBackground(PANEL);
        image.setForeground(MUTED);
        image.setBorder(BorderFactory.createLineBorder(new Color(48, 66, 84)));
        center.add(image, BorderLayout.WEST);

        JPanel form = new JPanel();
        form.setOpaque(false);
        form.setLayout(new BoxLayout(form, BoxLayout.Y_AXIS));
        addField(form, "CHECK INTERVAL (SECONDS)", interval);
        form.add(Box.createVerticalStrut(22));
        addField(form, "SHOP URL", shopUrl);
        shopUrl.setToolTipText("Paste an RSI shop page link");
        form.add(Box.createVerticalStrut(14));
        JLabel help = label("Cookies are accepted automatically; sign in if needed.", 12, Font.PLAIN, MUTED);
        help.setAlignmentX(Component.LEFT_ALIGNMENT);
        form.add(help);
        form.add(Box.createVerticalStrut(8));
        requireSignIn.setOpaque(false);
        requireSignIn.setForeground(TEXT);
        requireSignIn.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 12));
        requireSignIn.setFocusPainted(false);
        requireSignIn.setAlignmentX(Component.LEFT_ALIGNMENT);
        form.add(requireSignIn);
        form.add(Box.createVerticalStrut(8));
        JLabel checkoutHelp = label("When available, apply maximum store credit and open checkout.", 12, Font.PLAIN, MUTED);
        checkoutHelp.setAlignmentX(Component.LEFT_ALIGNMENT);
        form.add(checkoutHelp);
        form.add(Box.createVerticalGlue());
        center.add(form, BorderLayout.CENTER);
        root.add(center, BorderLayout.CENTER);

        JPanel bottom = new JPanel(new BorderLayout(16, 0));
        bottom.setOpaque(false);
        JPanel labels = new JPanel();
        labels.setOpaque(false);
        labels.setLayout(new BoxLayout(labels, BoxLayout.Y_AXIS));
        activity.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 12));
        activity.setForeground(MUTED);
        activity.setAlignmentX(Component.LEFT_ALIGNMENT);
        result.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 14));
        result.setForeground(TEXT);
        result.setAlignmentX(Component.LEFT_ALIGNMENT);
        detail.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 12));
        detail.setForeground(MUTED);
        detail.setOpaque(false);
        detail.setEditable(false);
        detail.setFocusable(false);
        detail.setLineWrap(true);
        detail.setWrapStyleWord(true);
        detail.setAlignmentX(Component.LEFT_ALIGNMENT);
        labels.add(activity);
        labels.add(Box.createVerticalStrut(6));
        labels.add(result);
        labels.add(Box.createVerticalStrut(3));
        labels.add(detail);
        bottom.add(labels, BorderLayout.CENTER);
        toggle.setBackground(ACCENT);
        toggle.setForeground(BACKGROUND);
        toggle.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 13));
        toggle.setFocusPainted(false);
        toggle.setBorder(new EmptyBorder(13, 20, 13, 20));
        toggle.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
        JPanel buttonWrap = new JPanel(new GridBagLayout());
        buttonWrap.setOpaque(false);
        buttonWrap.add(toggle);
        bottom.add(buttonWrap, BorderLayout.EAST);
        root.add(bottom, BorderLayout.SOUTH);
        return root;
    }

    private static JLabel label(String text, int size, int style, Color color) {
        JLabel label = new JLabel(text);
        label.setFont(new Font(Font.SANS_SERIF, style, size));
        label.setForeground(color);
        return label;
    }

    private static void addField(JPanel form, String caption, JTextField field) {
        JLabel heading = label(caption, 11, Font.BOLD, MUTED);
        heading.setAlignmentX(Component.LEFT_ALIGNMENT);
        form.add(heading);
        form.add(Box.createVerticalStrut(8));
        field.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 14));
        field.setForeground(TEXT);
        field.setCaretColor(TEXT);
        field.setBackground(PANEL);
        field.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(63, 83, 101)),
                new EmptyBorder(10, 11, 10, 11)));
        field.setMaximumSize(new Dimension(Integer.MAX_VALUE, 43));
        field.setAlignmentX(Component.LEFT_ALIGNMENT);
        form.add(field);
    }

    private void startMonitoring() {
        final long seconds;
        try {
            seconds = Long.parseLong(interval.getText().trim());
            if (seconds < 1 || seconds > Integer.MAX_VALUE) throw new NumberFormatException();
        } catch (NumberFormatException ex) {
            showError("Enter a whole number of seconds between 1 and " + Integer.MAX_VALUE + ".");
            return;
        }
        final String url = shopUrl.getText().trim();
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                    || !(host.equalsIgnoreCase("robertsspaceindustries.com")
                    || host.equalsIgnoreCase("www.robertsspaceindustries.com"))
                    || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException ex) {
            showError("Enter a valid https://robertsspaceindustries.com/ shop URL.");
            return;
        }

        // Checkout and any sign-in or cookie prompts need a visible browser.
        // Close a previous checkout browser before starting another session.
        if (session != null) stopMonitoring(false);
        Session current = new Session(true);
        session = current;
        image.setIcon(null);
        image.setText("Loading ship image…");
        setActive(true);
        final boolean checkSignIn = requireSignIn.isSelected();
        result.setText(checkSignIn ? "Checking sign-in…" : "Checking the shop…");
        detail.setText("The browser will open shortly.");
        current.worker = new Thread(() -> monitor(current, url, seconds, checkSignIn), "ship-monitor");
        current.worker.setDaemon(true);
        current.worker.start();
    }

    private void monitor(Session current, String url, long seconds, boolean requireAuthentication) {
        boolean imageRequested = false;
        boolean keepBrowserOpen = false;
        try {
            if (requireAuthentication) {
                while (current.running.get()) {
                    ShopChecker.CheckResult auth;
                    try {
                        auth = current.checker.checkSignIn(url);
                    } catch (InterruptedException ex) {
                        Thread.currentThread().interrupt();
                        break;
                    } catch (Exception ex) {
                        auth = new ShopChecker.CheckResult("UNKNOWN", "Could not verify sign-in: " + safeMessage(ex), "");
                    }
                    if (!current.running.get()) break;
                    if ("SIGNED_IN".equals(auth.status)) break;
                    final ShopChecker.CheckResult shown = auth;
                    SwingUtilities.invokeLater(() -> {
                        if (session != current || !current.running.get()) return;
                        activity.setText("●  WAITING FOR SIGN-IN");
                        result.setText("Waiting for sign-in");
                        detail.setText(shown.detail);
                        detail.setToolTipText(shown.detail);
                    });
                    try { Thread.sleep(2000); }
                    catch (InterruptedException ex) { Thread.currentThread().interrupt(); break; }
                }
                if (!current.running.get() || Thread.currentThread().isInterrupted()) return;
                SwingUtilities.invokeLater(() -> {
                    if (session != current || !current.running.get()) return;
                    activity.setText("●  ACTIVE");
                    result.setText("Signed in · checking the shop…");
                    detail.setText("Monitoring has started.");
                });
            }
            while (current.running.get()) {
                ShopChecker.CheckResult check;
                try {
                    check = current.checker.check(url);
                } catch (Exception ex) {
                    check = new ShopChecker.CheckResult("UNKNOWN", "Could not check the shop: " + safeMessage(ex), null);
                }
                if (!current.running.get()) break;
                if (!imageRequested && check.imageUrl != null && !check.imageUrl.isBlank()) {
                    imageRequested = true;
                    loadImage(current, url, check.imageUrl);
                } else if (!imageRequested) {
                    SwingUtilities.invokeLater(() -> {
                        if (session == current && image.getIcon() == null) image.setText("Ship image unavailable");
                    });
                }
                final ShopChecker.CheckResult displayed = check;
                SwingUtilities.invokeLater(() -> {
                    if (session != current || !current.running.get()) return;
                    result.setText(displayed.status + "  ·  " + LocalTime.now().format(CLOCK));
                    detail.setText(displayed.detail);
                    detail.setToolTipText(displayed.detail);
                });
                if ("AVAILABLE".equals(check.status)) {
                    if (requireAuthentication) {
                        ShopChecker.CheckResult auth;
                        try { auth = current.checker.checkSignIn(url); }
                        catch (Exception ex) { auth = new ShopChecker.CheckResult("UNKNOWN", "", ""); }
                        if (!"SIGNED_IN".equals(auth.status)) {
                            final String message = "Sign-in could not be verified. No cart action was attempted.";
                            keepBrowserOpen = true;
                            current.running.set(false);
                            SwingUtilities.invokeLater(() -> {
                                if (session != current) return;
                                setActive(false);
                                result.setText("NEEDS ATTENTION");
                                detail.setText(message);
                            });
                            break;
                        }
                    }
                    SwingUtilities.invokeLater(() -> {
                        if (session != current || !current.running.get()) return;
                        result.setText("AVAILABLE  ·  " + LocalTime.now().format(CLOCK));
                        detail.setText("Adding to cart, applying store credit, and opening checkout…");
                    });
                    ShopChecker.CheckResult checkout;
                    try {
                        checkout = current.checker.addToCartAndCheckout(message -> SwingUtilities.invokeLater(() -> {
                            if (session == current && current.running.get()) {
                                detail.setText(message);
                                detail.setToolTipText(message);
                            }
                        }));
                    } catch (Exception ex) {
                        checkout = new ShopChecker.CheckResult("NEEDS_ATTENTION",
                                "Could not complete checkout navigation: " + safeMessage(ex), null);
                    }
                    if (!current.running.get()) break;
                    // Keep the visible browser available for review until the window closes
                    // or the user starts another monitoring session.
                    keepBrowserOpen = true;
                    current.running.set(false);
                    final ShopChecker.CheckResult outcome = checkout;
                    SwingUtilities.invokeLater(() -> {
                        if (session != current) return;
                        setActive(false);
                        result.setText(outcome.status + "  ·  " + LocalTime.now().format(CLOCK));
                        String message = outcome.detail + (onAvailable.isEmpty() ? "" : " Running follow-up command…");
                        detail.setText(message);
                        detail.setToolTipText(message);
                    });
                    String followUpMessage = Thread.currentThread().isInterrupted() ? "" : runFollowUp();
                    if (!followUpMessage.isEmpty()) SwingUtilities.invokeLater(() -> {
                        if (session != current) return;
                        String message = outcome.detail + " " + followUpMessage;
                        detail.setText(message);
                        detail.setToolTipText(message);
                    });
                    break;
                }
                try {
                    Thread.sleep(seconds * 1000L);
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } finally {
            if (!keepBrowserOpen) current.checker.close();
        }
    }

    private String runFollowUp() {
        if (onAvailable.isEmpty()) return "";
        String message;
        try {
            Process process = new ProcessBuilder(onAvailable).redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            int code = process.waitFor();
            message = code == 0 ? "Follow-up command completed." : "Follow-up command failed (exit code " + code + ").";
        } catch (Exception ex) {
            if (ex instanceof InterruptedException) Thread.currentThread().interrupt();
            message = "Could not run follow-up command: " + safeMessage(ex);
        }
        return message;
    }

    private void stopMonitoring(boolean showStopped) {
        Session current = session;
        if (current == null) return;
        current.running.set(false);
        session = null;
        if (current.worker != null) current.worker.interrupt();
        Thread closer = new Thread(current.checker::close, "browser-cleanup");
        // Keep the JVM alive long enough to close the browser and remove its profile.
        closer.setDaemon(false);
        closer.start();
        setActive(false);
        if (showStopped) {
            result.setText("Monitoring stopped");
            detail.setText("Start again to check the shop.");
        }
    }

    private void setActive(boolean active) {
        activity.setText(active ? "●  ACTIVE" : "●  INACTIVE");
        activity.setForeground(active ? ACCENT : MUTED);
        interval.setEnabled(!active);
        shopUrl.setEnabled(!active);
        requireSignIn.setEnabled(!active);
        toggle.setText(active ? "Stop monitoring" : "Start monitoring");
    }

    private void loadImage(Session current, String pageUrl, String imageUrl) {
        Thread loader = new Thread(() -> {
            try {
                URI resolved = URI.create(pageUrl).resolve(imageUrl);
                if (!"https".equalsIgnoreCase(resolved.getScheme())) return;
                HttpURLConnection connection = (HttpURLConnection) new URL(resolved.toString()).openConnection();
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(10000);
                connection.setRequestProperty("User-Agent", "Mozilla/5.0");
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    int total = 0;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > 8 * 1024 * 1024) throw new IllegalArgumentException("Image is too large");
                        bytes.write(buffer, 0, count);
                    }
                    BufferedImage picture = ImageIO.read(new ByteArrayInputStream(bytes.toByteArray()));
                    if (picture == null) throw new IllegalArgumentException("Unsupported image");
                    SwingUtilities.invokeLater(() -> {
                        if (session != current) return;
                        int width = Math.max(1, image.getWidth() - 12);
                        int height = Math.max(1, image.getHeight() - 12);
                        double scale = Math.min((double) width / picture.getWidth(), (double) height / picture.getHeight());
                        image.setIcon(new ImageIcon(picture.getScaledInstance(Math.max(1, (int) (picture.getWidth() * scale)), Math.max(1, (int) (picture.getHeight() * scale)), Image.SCALE_SMOOTH)));
                        image.setText("");
                    });
                } finally {
                    connection.disconnect();
                }
            } catch (Exception ex) {
                SwingUtilities.invokeLater(() -> {
                    if (session == current) image.setText("Ship image unavailable");
                });
            }
        }, "ship-image");
        loader.setDaemon(true);
        loader.start();
    }

    private void showError(String text) {
        JOptionPane.showMessageDialog(this, text, "Check your input", JOptionPane.WARNING_MESSAGE);
    }

    private static String safeMessage(Exception ex) {
        return ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
    }

    public static void main(String[] args) {
        final List<String> followUp;
        if (args.length == 0) followUp = Collections.emptyList();
        else if (args.length > 1 && "--on-available".equals(args[0])) followUp = Arrays.asList(Arrays.copyOfRange(args, 1, args.length));
        else {
            System.err.println("Usage: java -jar ShipMonitor.jar [--on-available command [arguments...]]");
            return;
        }
        SwingUtilities.invokeLater(() -> new ShipMonitorApp(followUp).setVisible(true));
    }
}
