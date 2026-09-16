# actions-testing

A GitHub Actions workflow that, on a **Windows** runner:

1. Installs **MuMu Player** (the NetEase Android emulator — not MeMu/MEmu).
2. Boots the emulator.
3. Waits for it to come online over **ADB** (MuMu 12 main instance = port `16384`).
4. Takes a screenshot of the Android **home screen**.
5. Commits the PNG to this repo under [`screenshot/`](screenshot/) — **not** as a workflow artifact.

## Workflow

File: [`.github/workflows/mumu-screenshot.yml`](.github/workflows/mumu-screenshot.yml)

| Trigger | When it runs |
| --- | --- |
| `push` | When the workflow file itself is changed on `main` |
| `workflow_dispatch` | Manually, from the **Actions** tab → **Run workflow** |

The screenshot lands at `screenshot/mumu-home.png`.

## ⚠️ Important: virtualization requirement

MuMu Player is a **hypervisor-based** emulator and requires **VT-x / AMD-V** to be
available on the machine running the workflow. Emulators of this kind will not boot
without it (you get a black screen or a "virtualization not enabled" error).

- GitHub-hosted **`windows-latest`** runners are virtual machines **without nested
  virtualization**, so MuMu typically **cannot boot** there. The workflow is written
  to try anyway and fail with a clear message.
- To make it actually work, change `runs-on` to one of:
  - a **self-hosted Windows runner** (VT enabled in BIOS, Hyper-V off), or
  - a GitHub **"larger"** Windows runner (per-minute billing, nested
    virtualization available).

## How the screenshot is captured

```powershell
adb connect 127.0.0.1:16384       # MuMu 12 main instance
adb shell input keyevent 3         # HOME
adb shell screencap -p /sdcard/mumu-home.png
adb pull /sdcard/mumu-home.png screenshot/mumu-home.png
```

The upload uses the workflow's `GITHUB_TOKEN` (with `permissions: contents: write`)
and a plain `git push` — so the image always lives in the repository, viewable on
GitHub.

## Manual run

1. Open the **Actions** tab.
2. Select **MuMu emulator screenshot**.
3. Click **Run workflow** → **Run workflow** on `main`.
