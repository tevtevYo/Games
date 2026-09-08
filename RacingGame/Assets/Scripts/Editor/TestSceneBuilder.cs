using System.IO;
using RacingGame.Vehicle;
using Unity.Cinemachine;
using Unity.Cinemachine.TargetTracking;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RacingGame.Editor
{
    /// <summary>
    /// One-click test scene: a flat ground, a placeholder box car on four WheelColliders,
    /// some pillars for a sense of speed, and a Cinemachine chase camera.
    /// Menu: RacingGame > Build Test Scene
    /// </summary>
    public static class TestSceneBuilder
    {
        const string ScenePath = "Assets/Scenes/TestTrack.unity";
        const string MaterialsDir = "Assets/Materials";

        [MenuItem("RacingGame/Build Test Scene")]
        public static void Build()
        {
            // Scenes cannot be created during Play mode. Stop it, then build once the editor is back.
            if (EditorApplication.isPlaying)
            {
                EditorApplication.playModeStateChanged += BuildAfterPlayModeStops;
                EditorApplication.isPlaying = false;
                return;
            }

            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

            Material groundMat = GetOrCreateMaterial("Ground", new Color(0.35f, 0.38f, 0.35f));
            Material carMat = GetOrCreateMaterial("CarBody", new Color(0.85f, 0.15f, 0.12f));
            Material wheelMat = GetOrCreateMaterial("Wheel", new Color(0.08f, 0.08f, 0.08f));
            Material pillarMat = GetOrCreateMaterial("Pillar", new Color(0.95f, 0.75f, 0.1f));

            BuildGround(groundMat);
            BuildPillars(pillarMat);
            GameObject car = BuildCar(carMat, wheelMat);
            BuildChaseCamera(car.transform);

            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            EditorSceneManager.SaveScene(scene, ScenePath);
            AddSceneToBuildSettings(ScenePath);

            Selection.activeGameObject = car;
            Debug.Log("Test scene built and saved to " + ScenePath + ". Press Play and drive with W A S D. Space is the handbrake.");
        }

        static void BuildAfterPlayModeStops(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredEditMode) return;
            EditorApplication.playModeStateChanged -= BuildAfterPlayModeStops;
            Build();
        }

        static void BuildGround(Material mat)
        {
            GameObject ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Ground";
            ground.transform.localScale = new Vector3(40f, 1f, 40f); // 400 m x 400 m
            ground.GetComponent<Renderer>().sharedMaterial = mat;
            GameObjectUtility.SetStaticEditorFlags(ground, StaticEditorFlags.BatchingStatic);
        }

        static void BuildPillars(Material mat)
        {
            GameObject parent = new GameObject("Pillars");
            var rng = new System.Random(42);
            for (int i = 0; i < 40; i++)
            {
                GameObject pillar = GameObject.CreatePrimitive(PrimitiveType.Cube);
                pillar.name = "Pillar " + i;
                pillar.transform.SetParent(parent.transform);
                float x = (float)(rng.NextDouble() * 300 - 150);
                float z = (float)(rng.NextDouble() * 300 - 150);
                if (Mathf.Abs(x) < 15f && Mathf.Abs(z) < 15f) x += 30f; // keep the spawn area clear
                pillar.transform.position = new Vector3(x, 2f, z);
                pillar.transform.localScale = new Vector3(2f, 4f, 2f);
                pillar.GetComponent<Renderer>().sharedMaterial = mat;
            }
        }

        static GameObject BuildCar(Material bodyMat, Material wheelMat)
        {
            GameObject car = new GameObject("Car");
            car.transform.position = new Vector3(0f, 0.6f, 0f);

            var rb = car.AddComponent<Rigidbody>();
            rb.mass = 1200f;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
            rb.collisionDetectionMode = CollisionDetectionMode.Continuous;

            // Body: a simple box. Collider sits on the root so WheelColliders can live on children.
            var bodyCollider = car.AddComponent<BoxCollider>();
            bodyCollider.center = new Vector3(0f, 0.55f, 0f);
            bodyCollider.size = new Vector3(1.8f, 0.7f, 4.2f);

            GameObject body = GameObject.CreatePrimitive(PrimitiveType.Cube);
            body.name = "Body";
            Object.DestroyImmediate(body.GetComponent<Collider>());
            body.transform.SetParent(car.transform, false);
            body.transform.localPosition = new Vector3(0f, 0.55f, 0f);
            body.transform.localScale = new Vector3(1.8f, 0.7f, 4.2f);
            body.GetComponent<Renderer>().sharedMaterial = bodyMat;

            // A small cab so you can tell front from back.
            GameObject cab = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cab.name = "Cab";
            Object.DestroyImmediate(cab.GetComponent<Collider>());
            cab.transform.SetParent(car.transform, false);
            cab.transform.localPosition = new Vector3(0f, 1.1f, -0.4f);
            cab.transform.localScale = new Vector3(1.4f, 0.5f, 1.8f);
            cab.GetComponent<Renderer>().sharedMaterial = bodyMat;

            var controller = car.AddComponent<CarController>();
            controller.wheels = new CarController.Wheel[4];

            const float radius = 0.35f;
            Vector3[] positions =
            {
                new Vector3(-0.85f, radius, 1.4f),  // FL
                new Vector3(0.85f, radius, 1.4f),   // FR
                new Vector3(-0.85f, radius, -1.4f), // RL
                new Vector3(0.85f, radius, -1.4f),  // RR
            };
            string[] names = { "Wheel FL", "Wheel FR", "Wheel RL", "Wheel RR" };

            for (int i = 0; i < 4; i++)
            {
                bool front = i < 2;

                GameObject wheelGo = new GameObject(names[i]);
                wheelGo.transform.SetParent(car.transform, false);
                wheelGo.transform.localPosition = positions[i] + Vector3.up * 0.2f; // suspension rest height

                var wc = wheelGo.AddComponent<WheelCollider>();
                wc.radius = radius;
                wc.mass = 20f;
                wc.suspensionDistance = 0.25f;
                wc.suspensionSpring = new JointSpring { spring = 35000f, damper = 4500f, targetPosition = 0.5f };
                wc.forwardFriction = Friction(wc.forwardFriction, 1.4f);
                wc.sidewaysFriction = Friction(wc.sidewaysFriction, 1.6f);

                // Visual pivot receives the collider pose; the cylinder inside holds the 90 degree tilt.
                GameObject pivot = new GameObject(names[i] + " Visual");
                pivot.transform.SetParent(car.transform, false);
                pivot.transform.localPosition = positions[i];

                GameObject cyl = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                cyl.name = "Mesh";
                Object.DestroyImmediate(cyl.GetComponent<Collider>());
                cyl.transform.SetParent(pivot.transform, false);
                cyl.transform.localRotation = Quaternion.Euler(0f, 0f, 90f);
                cyl.transform.localScale = new Vector3(radius * 2f, 0.15f, radius * 2f);
                cyl.GetComponent<Renderer>().sharedMaterial = wheelMat;

                controller.wheels[i] = new CarController.Wheel
                {
                    collider = wc,
                    visual = pivot.transform,
                    steers = front,
                    drives = true, // all-wheel drive is the most forgiving for a placeholder
                };
            }

            return car;
        }

        static WheelFrictionCurve Friction(WheelFrictionCurve curve, float stiffness)
        {
            curve.stiffness = stiffness;
            return curve;
        }

        static void BuildChaseCamera(Transform target)
        {
            Camera main = Camera.main;
            if (main != null && main.GetComponent<CinemachineBrain>() == null)
                main.gameObject.AddComponent<CinemachineBrain>();

            GameObject camGo = new GameObject("Chase Camera");
            var cm = camGo.AddComponent<CinemachineCamera>();
            cm.Follow = target;
            cm.LookAt = target;

            var follow = camGo.AddComponent<CinemachineFollow>();
            follow.FollowOffset = new Vector3(0f, 3.5f, -8f);
            follow.TrackerSettings.BindingMode = BindingMode.LazyFollow;
            follow.TrackerSettings.PositionDamping = new Vector3(0.5f, 0.5f, 1f);

            var composer = camGo.AddComponent<CinemachineRotationComposer>();
            composer.TargetOffset = new Vector3(0f, 1f, 0f);
            composer.Damping = new Vector2(0.5f, 0.5f);
        }

        static Material GetOrCreateMaterial(string name, Color color)
        {
            Directory.CreateDirectory(MaterialsDir);
            string path = MaterialsDir + "/" + name + ".mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                mat = new Material(shader != null ? shader : Shader.Find("Standard"));
                mat.color = color;
                AssetDatabase.CreateAsset(mat, path);
            }
            return mat;
        }

        static void AddSceneToBuildSettings(string path)
        {
            var scenes = new System.Collections.Generic.List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            if (scenes.Exists(s => s.path == path)) return;
            scenes.Insert(0, new EditorBuildSettingsScene(path, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }
    }
}
