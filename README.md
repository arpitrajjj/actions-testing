# actions-testing

GitHub Actions experiments that capture **home-screen screenshots** and commit
them to this repo under [`screenshot/`](screenshot/) (not as workflow artifacts).

## Workflows

| Workflow | Runner | What it captures | Output |
| --- | --- | --- | --- |
| **Android emulator screenshot** | `ubuntu-latest` | Boots a real **Android Emulator (AVD)** via KVM and captures the Android **home screen** | `screenshot/android-home.png` |
| **macOS home screen screenshot** | `macos-latest` | Captures the macOS **Desktop** | `screenshot/macos-home.png` |

File: `.github/workflows/android-emulator-screenshot.yml`

### Why not BlueStacks / MuMu?

BlueStacks, MuMu, LDPlayer, etc. are Windows/Android-x86 hypervisor apps that
require **VT-x/AMD-V** exposed to the host. No free GitHub-hosted runner (Windows
or otherwise) provides that. The **official Android Emulator**, however, boots on
`ubuntu-latest` because GitHub's Linux runners expose **KVM** (`/dev/kvm`).

## How the Android screenshot is captured

```bash
# KVM enabled first, then:
adb wait-for-device
adb shell input keyevent 3                  # HOME
adb exec-out screencap -p > screenshot/android-home.png
```

Both workflows push with the `GITHUB_TOKEN` (`permissions: contents: write`),
using a plain `git push` so the image always lives in the repository.

## Manual run

1. Open the **Actions** tab.
2. Pick the workflow you want.
3. Click **Run workflow** → **Run workflow** on `main`.
