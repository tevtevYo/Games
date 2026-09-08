# Games

## RacingGame

A 3D third-person racing game built with Unity.

| | |
|---|---|
| Engine | Unity 6000.3.23f1 (Unity 6.3 LTS) |
| Render pipeline | Universal Render Pipeline (URP) |
| Input | Unity Input System (`Assets/InputSystem_Actions.inputactions`) |
| Camera | Cinemachine 3 (third-person follow) |
| Modelling | Blender 5.2 |
| IDE | Visual Studio 2022 Community, "Game development with Unity" workload |

### Opening the project

1. Open Unity Hub and sign in with a Unity ID. A free Personal licence activates automatically.
2. Choose **Add**, then **Add project from disk**, and pick the `RacingGame` folder.
3. Open it with editor 6000.3.23f1. The first open imports packages and takes a few minutes.

### Layout

```
RacingGame/
  Assets/
    Scenes/        SampleScene.unity (starting scene)
    Scripts/
      Vehicle/     CarController.cs (WheelCollider-based arcade car)
    Prefabs/       car and track prefabs
    Materials/
    Tracks/        track scenes and assets
    Settings/      URP pipeline and renderer assets
  Packages/        manifest.json (package list)
  ProjectSettings/
```

### Controls (default)

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake | W / S | Left stick up / down |
| Steer | A / D | Left stick left / right |
| Handbrake | Space | South button |
