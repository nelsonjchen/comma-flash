# flash

► [flash.comma.ai](https://flash.comma.ai)

This tool allows you to flash AGNOS onto your comma device. Uses [qdl.js](https://github.com/commaai/qdl.js).

## Storage modes

* **Standard** first verifies local disk space by writing a temporary 5.25 GiB blank file. The file is held as a reservation until flashing begins, then deleted before images are downloaded and staged for A/B partitions.
* **Low storage (experimental)** streams downloaded XZ images through a bounded-memory decompressor directly to the device. It does not require OPFS, but requires a stable connection and downloads images for A/B partitions once per slot.

## Development

```bash
bun install
bun dev
```

Open [http://localhost:5173](http://localhost:5173) with your browser to see the result.

You can start editing the page by modifying `src/app/index.jsx`. The page auto-updates as you edit the file.

**Helpful for debugging**
* [chrome://usb-internals/](chrome://usb-internals/)
* [chrome://device-log/](chrome://device-log/)
* Add `?fast=1` to the URL to skip flashing the system partition (the slowest). Useful for testing the full flow quickly.
* Add `?windows=1` to the URL to force Windows mode (shows Zadig driver instructions). Useful for testing the Windows flow on other platforms.
