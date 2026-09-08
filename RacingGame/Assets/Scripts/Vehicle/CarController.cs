using UnityEngine;
using UnityEngine.InputSystem;

namespace RacingGame.Vehicle
{
    /// <summary>
    /// Arcade-leaning car controller built on Unity WheelColliders.
    /// Attach to a Rigidbody car root. Assign four WheelColliders and their visual meshes.
    /// Reads input from the "Player" action map (Move, plus Jump reused as handbrake) via
    /// PlayerInput, or falls back to direct keyboard polling if no PlayerInput is present.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class CarController : MonoBehaviour
    {
        [System.Serializable]
        public class Wheel
        {
            public WheelCollider collider;
            public Transform visual;
            public bool steers;
            public bool drives;
        }

        [Header("Wheels (FL, FR, RL, RR)")]
        public Wheel[] wheels = new Wheel[4];

        [Header("Drive")]
        [Tooltip("Motor torque applied to each driven wheel at full throttle.")]
        public float maxMotorTorque = 1500f;
        [Tooltip("Brake torque applied to every wheel when braking.")]
        public float maxBrakeTorque = 3000f;
        [Tooltip("Top speed in km/h. Throttle is cut above this.")]
        public float topSpeedKph = 180f;

        [Header("Steering")]
        public float maxSteerAngle = 30f;
        [Tooltip("Steering is reduced toward this fraction of maxSteerAngle at top speed.")]
        [Range(0.1f, 1f)] public float highSpeedSteerFactor = 0.4f;
        public float steerSmoothing = 8f;

        [Header("Stability")]
        [Tooltip("Lowering the centre of mass makes the car far less likely to roll.")]
        public Vector3 centerOfMassOffset = new Vector3(0f, -0.5f, 0f);
        [Tooltip("Extra downward force scaled by speed. Keeps the car planted.")]
        public float downforce = 50f;

        public float SpeedKph { get; private set; }

        Rigidbody _rb;
        float _throttle;
        float _steerInput;
        float _currentSteer;
        bool _handbrake;

        void Awake()
        {
            _rb = GetComponent<Rigidbody>();
            _rb.centerOfMass += centerOfMassOffset;
        }

        // Called by PlayerInput (Send Messages behaviour) from the "Move" action.
        public void OnMove(InputValue value)
        {
            Vector2 v = value.Get<Vector2>();
            _steerInput = v.x;
            _throttle = v.y;
        }

        // Called by PlayerInput from the "Jump" action, reused as the handbrake.
        public void OnJump(InputValue value)
        {
            _handbrake = value.isPressed;
        }

        void Update()
        {
            // Fallback so the car is drivable before a PlayerInput component is wired up.
            if (GetComponent<PlayerInput>() == null && Keyboard.current != null)
            {
                var k = Keyboard.current;
                _steerInput = (k.dKey.isPressed ? 1f : 0f) - (k.aKey.isPressed ? 1f : 0f);
                _throttle = (k.wKey.isPressed ? 1f : 0f) - (k.sKey.isPressed ? 1f : 0f);
                _handbrake = k.spaceKey.isPressed;
            }
        }

        void FixedUpdate()
        {
            SpeedKph = _rb.linearVelocity.magnitude * 3.6f;

            float speedT = Mathf.Clamp01(SpeedKph / topSpeedKph);
            float steerLimit = Mathf.Lerp(maxSteerAngle, maxSteerAngle * highSpeedSteerFactor, speedT);
            _currentSteer = Mathf.Lerp(_currentSteer, _steerInput * steerLimit, steerSmoothing * Time.fixedDeltaTime);

            float forwardDot = Vector3.Dot(_rb.linearVelocity, transform.forward);
            bool reversingIntent = _throttle < 0f && forwardDot > 1f;
            bool overSpeed = SpeedKph >= topSpeedKph && _throttle > 0f;

            float motor = (overSpeed || reversingIntent) ? 0f : _throttle * maxMotorTorque;
            float brake = reversingIntent ? maxBrakeTorque : 0f;

            foreach (var w in wheels)
            {
                if (w.collider == null) continue;

                if (w.steers) w.collider.steerAngle = _currentSteer;
                if (w.drives) w.collider.motorTorque = motor;

                w.collider.brakeTorque = (_handbrake && !w.steers) ? maxBrakeTorque : brake;

                if (w.visual != null)
                {
                    w.collider.GetWorldPose(out Vector3 pos, out Quaternion rot);
                    w.visual.SetPositionAndRotation(pos, rot);
                }
            }

            _rb.AddForce(-transform.up * downforce * _rb.linearVelocity.magnitude);
        }
    }
}
