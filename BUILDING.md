# Building the Windows application

The Windows build creates a runnable JAR and a self-contained application
folder containing an EXE launcher and its own Java runtime. End users do not
need to install Java separately. A supported Chromium-based default browser must
be installed on the computer running the application; the browser is not bundled.

Install a Windows JDK 17 or newer that includes `javac`, `jar`, `jlink`, and
`jpackage`. In PowerShell, from this project folder, run:

```powershell
./build.ps1
```

The script uses `JAVA_HOME`, a JDK on `PATH`, or a JDK under the current user's
`.jdks` directory. You can instead choose one explicitly:

```powershell
./build.ps1 -JdkHome 'C:\path\to\your\jdk'
```

The output is:

- `dist\ShipMonitor.jar`: the executable Java archive. Run this with the same
  Java version used to build it, or a newer one, using
  `java -jar dist\ShipMonitor.jar`. The supplied build uses Java 25. To run
  the JAR with the bundled runtime instead of Java from your system `PATH`:

  ```powershell
  & .\dist\ShipMonitor\runtime\bin\java.exe -jar .\dist\ShipMonitor.jar
  ```
- `dist\ShipMonitor\ShipMonitor.exe`: the Windows launcher. **Keep the entire
  `dist\ShipMonitor` folder together**, including `app` and `runtime`; the
  launcher is not a standalone EXE. Start it by double-clicking the EXE.

To make your own installer, add the entire `dist\ShipMonitor` folder to your
installer and create a shortcut to `ShipMonitor.exe`. Alternatively,
`./build.ps1 -Installer` asks `jpackage` to create an EXE installation wizard
in `dist`. That optional step requires a compatible Windows WiX Toolset on
`PATH`; it is not needed for the application folder. The resulting installer
should be tested on a clean Windows machine before distribution.

Close the application before rebuilding its output folder. The build stops if
the packaged application is running. Rebuilding removes and recreates `build\classes`, `build\input`,
`build\runtime`, and `dist\ShipMonitor`. Keep personal files outside those
generated folders.
