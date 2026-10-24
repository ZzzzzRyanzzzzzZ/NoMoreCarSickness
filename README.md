# Motion Cues

Car-sickness dots for a Windows laptop, driven by your iPhone's motion sensor.

Car sickness comes from your eyes (looking at a still screen) disagreeing with your inner ear (feeling the
car move). Motion Cues puts dots along the edges of your screen that drift with the car's acceleration,
braking and turns, so your eyes get the same motion signal. The dots sit on top of every app and ignore the
mouse, so you keep working as normal.

## Run it

```bash
npm install
npm start
```

A settings window opens and a blue dot appears in the system tray.

## Connect the iPhone

1. Put the laptop and phone on the same network. In a car: turn on the iPhone's **Personal Hotspot** and
   join it from the laptop.
2. Scan the QR code in the settings window with the iPhone camera (or type the link) and open it in **Safari**.
3. Safari will say the connection isn't private, because the certificate was made on your laptop.
   Tap **Show Details → visit this website**. iPhones only share motion data over HTTPS, which is why this
   step is needed.
4. Pick how the phone is sitting, tap **Start sending motion**, and allow motion access.
5. If Windows Firewall asks, allow it on **private and public** networks (hotspots often count as public).

Keep the Safari page open; it keeps the phone screen awake. With the car stopped, tap **Zero** once.

## Customize

Everything in the settings window applies live and is saved:

- **Dots**: size, color (picker, hex or red/green/blue sliders), opacity, and a contrast ring that keeps
  the dots visible on light and dark windows
- **Layout**: left and right edges, all four edges, or a sparse grid over the whole screen; dots per edge,
  number of columns, distance from the edge
- **Motion**: sensitivity, responsiveness, fade out when the car is steady, flip left/right or up/down if
  the direction feels wrong, and **demo motion** to tune the look without the phone

`Ctrl+Alt+M` shows or hides the dots. Closing the window keeps the app running in the tray; quit from the
tray menu.
