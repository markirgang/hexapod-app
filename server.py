#!/usr/bin/env python3
import http.server
import socketserver
import json
import os
import sys
import cv2
import base64
import threading
import time
import random
import urllib.parse
import re
from gemini_bridge import GeminiHexapodBridge
import numpy as np

PORT = int(os.environ.get("PORT", 8090))
HOST = os.environ.get("HOST", os.environ.get("IP", "0.0.0.0"))
DIRECTORY = os.environ.get("DIRECTORY", os.path.join(os.path.dirname(os.path.abspath(__file__)), "static"))
AUDIO_DIR = os.path.join(DIRECTORY, "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

def generate_synthetic_camera_frame():
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[:, :] = (30, 25, 20)
    cv2.putText(frame, "HEXAPOD CAMERA FEED", (150, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 240, 255), 2)
    cv2.putText(frame, "STATUS: Virtual Camera Active", (160, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (160, 255, 160), 1)
    t_str = time.strftime("%H:%M:%S")
    cv2.putText(frame, f"LIVE TIME: {t_str}", (220, 280), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    return frame

# Thread-safe Background Camera Stream (Supports USB Webcams & Picamera2 Raspberry Pi CSI Camera)
class CameraStream:
    def __init__(self, source="usb"):
        self.source = str(source).lower()
        self.cap = None
        self.picam2 = None
        self.frame = None
        self.lock = threading.Lock()
        self.running = True
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()

    def set_source(self, source):
        with self.lock:
            self.source = str(source).lower()
            self._close_cameras()

    def _close_cameras(self):
        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None
        if self.picam2:
            try:
                self.picam2.stop()
                self.picam2.close()
            except Exception:
                pass
            self.picam2 = None

    def _update(self):
        while self.running:
            with self.lock:
                cur_source = self.source

            # Option A: Raspberry Pi CSI Camera via Picamera2
            if cur_source in ["csi", "picamera", "raspberry_pi", "ov5647"]:
                if self.picam2 is None:
                    self._close_cameras()
                    try:
                        from picamera2 import Picamera2
                        p = Picamera2()
                        config = p.create_preview_configuration(main={'size': (640, 480)})
                        p.configure(config)
                        p.start()
                        time.sleep(0.3)
                        self.picam2 = p
                        print("Picamera2 CSI Camera initialized successfully")
                    except Exception as e:
                        print("Picamera2 CSI Camera init error:", e)
                        self.picam2 = None
                        time.sleep(1.0)
                        continue

                try:
                    frame_array = self.picam2.capture_array('main')
                    if frame_array is not None and frame_array.size > 0:
                        if frame_array.shape[2] == 4:
                            frame_bgr = cv2.cvtColor(frame_array, cv2.COLOR_RGBA2BGR)
                        else:
                            frame_bgr = frame_array
                        with self.lock:
                            self.frame = frame_bgr
                    time.sleep(0.04)
                except Exception as e:
                    print("CSI frame capture error:", e)
                    self._close_cameras()
                    time.sleep(0.5)

            # Option B: USB Webcam via OpenCV V4L2
            else:
                if self.cap is None or not self.cap.isOpened():
                    self._close_cameras()
                    candidates = [0, 1, 6, 2, 8]
                    if cur_source.isdigit():
                        candidates.insert(0, int(cur_source))
                    candidates = list(dict.fromkeys(candidates))

                    opened = False
                    for idx in candidates:
                        try:
                            cap = cv2.VideoCapture(idx, cv2.CAP_V4L2)
                            if cap.isOpened():
                                ret, frame = cap.read()
                                if ret and frame is not None and frame.size > 0:
                                    self.cap = cap
                                    with self.lock:
                                        self.frame = frame
                                    opened = True
                                    break
                                else:
                                    cap.release()
                        except Exception:
                            pass

                    if not opened:
                        time.sleep(4.0)

                if self.cap and self.cap.isOpened():
                    try:
                        ret, frame = self.cap.read()
                        if ret and frame is not None and frame.size > 0:
                            with self.lock:
                                self.frame = frame
                            time.sleep(0.04)
                        else:
                            self._close_cameras()
                            time.sleep(1.0)
                    except Exception:
                        self._close_cameras()
                        time.sleep(1.0)
                else:
                    time.sleep(0.5)

    def get_frame(self):
        with self.lock:
            if self.frame is not None:
                return self.frame.copy()
        return generate_synthetic_camera_frame()

camera_stream = CameraStream("usb")
gemini_bridge = GeminiHexapodBridge()

# Simulated Hardware Hardware State
motor_state = {
    "mouth_channel1": False, # L298 Channel 1 (DC Motor: Moving Mouth)
    "neck_channel2": False   # L298 Channel 2 (DC Motor: Pulsating Neck)
}

sensor_state = {
    "front": 45, # cm
    "rear": 120,
    "left": 80,
    "right": 65
}

def update_simulated_sensors():
    while True:
        # Dynamic small variation simulating ultrasonic distance sensor noise/movement
        sensor_state["front"] = max(10, min(200, sensor_state["front"] + random.randint(-2, 2)))
        sensor_state["rear"]  = max(10, min(200, sensor_state["rear"]  + random.randint(-2, 2)))
        sensor_state["left"]  = max(10, min(200, sensor_state["left"]  + random.randint(-2, 2)))
        sensor_state["right"] = max(10, min(200, sensor_state["right"] + random.randint(-2, 2)))
        time.sleep(0.5)

threading.Thread(target=update_simulated_sensors, daemon=True).start()

# Default saved poses library
SAVED_POSES = {
    "Stand": {
        "body": {"height": 0, "roll": 0, "pitch": 0, "yaw": 0},
        "description": "Standard standing neutral pose"
    },
    "Bounce & Wave Dance": {
        "body": {"height": 12, "roll": 0, "pitch": -10, "yaw": 0},
        "description": "Up-down body bouncing while waving legs high in the air"
    },
    "Ultimate Combo Dance": {
        "body": {"height": 15, "roll": 0, "pitch": 0, "yaw": 0},
        "description": "Grand multi-stage dance combining dual leg waves, bouncing, tilting, and twisting"
    },
    "Flatten Legs": {
        "body": {"height": -50, "roll": 0, "pitch": 0, "yaw": 0},
        "description": "All 6 legs stretched flat against the floor"
    },
    "Dual Legs Air Wave": {
        "body": {"height": 15, "roll": 0, "pitch": -12, "yaw": 0},
        "description": "Waving left and right front legs high in the air"
    },
    "Wave Front Right": {
        "body": {"height": 10, "roll": 12, "pitch": -10, "yaw": 10},
        "description": "Waving right front leg in the air"
    },
    "Wave Front Left": {
        "body": {"height": 10, "roll": -12, "pitch": -10, "yaw": -10},
        "description": "Waving left front leg in the air"
    },
    "Alternating Front Leg Wave": {
        "body": {"height": 12, "roll": 0, "pitch": -10, "yaw": 0},
        "description": "Lifting right and left front legs one at a time and waving rhythmically"
    },
    "Macarena Hexapod": {
        "body": {"height": 10, "roll": 10, "pitch": -8, "yaw": 15},
        "description": "Sequential leg extensions, hip sways, and turn bounce"
    },
    "Sequential Leg Wave Shuffle": {
        "body": {"height": 8, "roll": 0, "pitch": 0, "yaw": 0},
        "description": "Waving each of the 6 legs sequentially one at a time"
    },
    "Catwalk Front Leg Strut": {
        "body": {"height": 15, "roll": -10, "pitch": -12, "yaw": -10},
        "description": "High front leg lift strut with rhythmic waving"
    },
    "Techno Beat Shuffle": {
        "body": {"height": 15, "roll": 15, "pitch": 10, "yaw": 20},
        "description": "Fast-tempo rhythmic bouncing with alternating front leg lifts"
    },
    "K-Pop Synchronized Groove": {
        "body": {"height": 10, "roll": 12, "pitch": -5, "yaw": 15},
        "description": "K-Pop idol style dance with alternating leg waves and hip sways"
    },
    "Mid Legs Air Wave": {
        "body": {"height": 10, "roll": 0, "pitch": 0, "yaw": 0},
        "description": "Waving left and right middle legs in the air"
    },
    "Air Celebration": {
        "body": {"height": 15, "roll": 0, "pitch": -12, "yaw": 0},
        "description": "All front and middle legs waving in celebration"
    },
    "Disco Boogie Dance": {
        "body": {"height": 10, "roll": 10, "pitch": 5, "yaw": 10},
        "description": "Upbeat disco boogie dance routine"
    },
    "Twist & Shimmy": {
        "body": {"height": 0, "roll": 15, "pitch": 0, "yaw": 20},
        "description": "Fast body twist and roll shimmy dance"
    },
    "Hexapod Salsa": {
        "body": {"height": 5, "roll": 18, "pitch": 8, "yaw": 12},
        "description": "Rhythmic salsa dance with body sways"
    },
    "Robot Breakdance": {
        "body": {"height": -25, "roll": 12, "pitch": 15, "yaw": 25},
        "description": "Crouched breakdance routine with high leg kicks"
    },
    "Moonwalk Slide": {
        "body": {"height": -10, "roll": 0, "pitch": 18, "yaw": 0},
        "description": "Backward sliding moonwalk pose"
    },
    "Dance Sway": {
        "body": {"height": 10, "roll": 15, "pitch": 10, "yaw": 15},
        "description": "Smooth swaying body dance motion"
    },
    "Low Stance": {
        "body": {"height": -30, "roll": 0, "pitch": 0, "yaw": 0},
        "description": "Crouched defensive stance"
    },
    "High Stance": {
        "body": {"height": 30, "roll": 0, "pitch": 0, "yaw": 0},
        "description": "Elevated observation stance"
    },
    "Greeting Wave": {
        "body": {"height": 10, "roll": 15, "pitch": -10, "yaw": 10},
        "description": "Front leg raised greeting posture"
    },
    "Attack / Aggressive": {
        "body": {"height": -15, "roll": 0, "pitch": 20, "yaw": 0},
        "description": "Forward tilted alert posture"
    }
}

class HexapodRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_HEAD(self):
        if self.path.startswith("/api/"):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
        else:
            super().do_HEAD()

    def do_GET(self):
        if self.path.startswith("/api/status"):
            self.send_json({"status": "online", "device": "Raspberry Pi", "python_version": sys.version})
        elif self.path.startswith("/api/poses"):
            self.send_json(SAVED_POSES)
        elif self.path.startswith("/api/audio/list"):
            try:
                audio_files = [f for f in os.listdir(AUDIO_DIR) if f.lower().endswith(('.mp3', '.wav', '.ogg', '.m4a', '.flac'))]
                audio_files.sort()
                self.send_json({"files": audio_files})
            except Exception as e:
                self.send_json({"files": [], "error": str(e)})
        elif self.path.startswith("/api/camera/frame"):
            self.serve_camera_frame()
        elif self.path.startswith("/api/sensors/distances"):
            self.send_json(sensor_state)
        elif self.path.startswith("/api/motor/state"):
            self.send_json(motor_state)
        elif self.path.startswith("/api/tts/speak"):
            query_params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            text_to_speak = query_params.get("text", ["Hello!"])[0]
            voice_id = query_params.get("voice", ["ai_female_us"])[0]

            try:
                from gtts import gTTS
                import io
                clean_text = re.sub(r'\*[^*]*\*', '', text_to_speak).strip()
                if not clean_text:
                    clean_text = "Hello!"

                tld_map = {
                    "ai_female_us": ("en", "com"),
                    "ai_male_us": ("en", "us"),
                    "ai_male_uk": ("en", "co.uk"),
                    "ai_male_au": ("en", "com.au"),
                    "ai_male_ie": ("en", "ie"),
                    "ai_male_in": ("en", "co.in"),
                    "ai_male_za": ("en", "co.za"),
                    "ai_male_ca": ("en", "ca"),
                    "ai_female_uk": ("en", "co.uk"),
                    "ai_female_au": ("en", "com.au"),
                    "ai_female_ca": ("en", "ca"),
                    "ai_female_in": ("en", "co.in")
                }

                lang, tld = tld_map.get(voice_id, ("en", "com"))
                tts = gTTS(text=clean_text, lang=lang, tld=tld)
                mp3_fp = io.BytesIO()
                tts.write_to_fp(mp3_fp)
                mp3_fp.seek(0)
                audio_bytes = mp3_fp.read()

                self.send_response(200)
                self.send_header('Content-type', 'audio/mpeg')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(audio_bytes)
            except Exception as e:
                self.send_json({"error": str(e)}, status=500)
        else:
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else "{}"
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = {}

        if self.path == "/api/motor/l298":
            motor_state["mouth_channel1"] = data.get("mouth", False)
            motor_state["neck_channel2"]  = data.get("neck", False)
            self.send_json({"success": True, "state": motor_state})

        elif self.path == "/api/camera/select":
            source = data.get("source", "usb")
            camera_stream.set_source(source)
            self.send_json({"success": True, "active_source": source})

        elif self.path == "/api/gemini/chat":
            user_text = data.get("prompt", "")
            DEFAULT_GEMINI_KEY = ""
            api_key = data.get("api_key") or os.environ.get("GEMINI_API_KEY") or DEFAULT_GEMINI_KEY
            include_vision = data.get("include_vision", True)

            image_bytes = None
            if include_vision:
                image_bytes = self.capture_camera_bytes()

            result = gemini_bridge.generate_chat_response(api_key, user_text, image_bytes)
            self.send_json(result)

        elif self.path == "/api/gemini/voice":
            DEFAULT_GEMINI_KEY = ""
            api_key = data.get("api_key") or os.environ.get("GEMINI_API_KEY") or DEFAULT_GEMINI_KEY
            audio_b64 = data.get("audio_b64", "")
            mime_type = data.get("mime_type", "audio/webm")
            include_vision = data.get("include_vision", True)

            audio_bytes = base64.b64decode(audio_b64) if audio_b64 else None
            image_bytes = self.capture_camera_bytes() if include_vision else None

            result = gemini_bridge.generate_voice_chat_response(api_key, audio_bytes, mime_type, image_bytes)
            self.send_json(result)

        elif self.path == "/api/gemini/gesture":
            frame = self.capture_camera_frame()
            if frame is None:
                self.send_json({"gesture": "None", "finger_count": 0, "action": None})
            else:
                gesture, finger_count, _ = gemini_bridge.detect_hand_gestures(frame)
                action = None
                if gesture == "5_FINGERS_FORWARD":
                    action = {"name": "hexapod_walk", "args": {"direction": "forward"}}
                elif gesture == "2_FINGERS_WAVE":
                    action = {"name": "hexapod_pose", "args": {"pose_name": "Greeting Wave"}}
                elif gesture == "1_FINGER_ATTACK":
                    action = {"name": "hexapod_pose", "args": {"pose_name": "Attack / Aggressive"}}

                self.send_json({
                    "gesture": gesture,
                    "finger_count": finger_count,
                    "action": action
                })

        elif self.path == "/api/export-python":
            python_script = self.generate_hardware_script(data)
            self.send_response(200)
            self.send_header('Content-type', 'application/x-python')
            self.send_header('Content-Disposition', 'attachment; filename="hexapod_l298_sr04_control.py"')
            self.end_headers()
            self.wfile.write(python_script.encode('utf-8'))

        elif self.path == "/api/save-pose":
            pose_name = data.get("name", "Custom Pose")
            SAVED_POSES[pose_name] = data.get("pose", {})
            self.send_json({"success": True, "message": f"Saved pose '{pose_name}'"})

        elif self.path == "/api/audio/upload":
            filename = data.get("filename", "track.mp3")
            data_b64 = data.get("data_b64", "")
            # Sanitize filename
            safe_filename = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', filename)
            if not safe_filename.lower().endswith(('.mp3', '.wav', '.ogg', '.m4a', '.flac')):
                safe_filename += ".mp3"
            
            try:
                raw_bytes = base64.b64decode(data_b64)
                file_path = os.path.join(AUDIO_DIR, safe_filename)
                with open(file_path, "wb") as f:
                    f.write(raw_bytes)
                self.send_json({"success": True, "filename": safe_filename, "url": f"/audio/{safe_filename}"})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)}, status=500)

        elif self.path == "/api/audio/delete":
            filename = data.get("filename", "")
            safe_filename = os.path.basename(filename)
            file_path = os.path.join(AUDIO_DIR, safe_filename)
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    self.send_json({"success": True, "message": f"Deleted {safe_filename}"})
                except Exception as e:
                    self.send_json({"success": False, "error": str(e)}, status=500)
            else:
                self.send_json({"success": False, "error": "File not found"}, status=404)
        else:
            self.send_json({"error": "Endpoint not found"}, status=404)

    def capture_camera_frame(self):
        return camera_stream.get_frame()

    def capture_camera_bytes(self):
        frame = self.capture_camera_frame()
        if frame is None:
            frame = generate_synthetic_camera_frame()
        ret, jpeg = cv2.imencode('.jpg', frame)
        return jpeg.tobytes() if ret else None

    def serve_camera_frame(self):
        jpeg_bytes = self.capture_camera_bytes()
        if jpeg_bytes is None:
            try:
                self.send_response(503)
                self.end_headers()
            except Exception:
                pass
            return
        try:
            self.send_response(200)
            self.send_header('Content-type', 'image/jpeg')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            self.wfile.write(jpeg_bytes)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def send_json(self, data, status=200):
        try:
            self.send_response(status)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def generate_hardware_script(self, data):
        angles = data.get("angles", {})
        script = f'''#!/usr/bin/env python3
"""
Hexapod Hardware Control Master Script
Integrated 18x Servos (PCA9685), L298N Dual Motor Controller (Mouth + Neck),
and 4x HC-SR04 Ultrasonic Distance Sensors (Front, Rear, Left, Right).
"""

import time
import board
import busio
import RPi.GPIO as GPIO
from adafruit_pca9685 import PCA9685
from adafruit_motor import servo

# --- GPIO Pin Definitions ---
# L298N Motor Driver
L298_ENA = 18  # Channel 1 PWM Speed Control (Mouth Motor)
L298_IN1 = 23  # Channel 1 Motor Direction
L298_IN2 = 24  # Channel 1 Motor Direction

L298_ENB = 19  # Channel 2 PWM Speed Control (Pulsating Neck Motor)
L298_IN3 = 25  # Channel 2 Motor Direction
L298_IN4 = 8   # Channel 2 Motor Direction

# 4x HC-SR04 Ultrasonic Sensors (Trig / Echo)
SENSORS = {{
    "front": {{"trig": 5, "echo": 6}},
    "rear":  {{"trig": 12, "echo": 13}},
    "left":  {{"trig": 16, "echo": 20}},
    "right": {{"trig": 21, "echo": 26}}
}}

# --- Initialize GPIO & Motors ---
GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

# Setup L298 Motor Pins
GPIO.setup([L298_ENA, L298_IN1, L298_IN2, L298_ENB, L298_IN3, L298_IN4], GPIO.OUT)
pwm_mouth = GPIO.PWM(L298_ENA, 1000)
pwm_neck  = GPIO.PWM(L298_ENB, 1000)
pwm_mouth.start(0)
pwm_neck.start(0)

# Setup HC-SR04 Sensor Pins
for name, pins in SENSORS.items():
    GPIO.setup(pins["trig"], GPIO.OUT)
    GPIO.setup(pins["echo"], GPIO.IN)
    GPIO.output(pins["trig"], False)

# Initialize I2C Bus for Servo Drivers
i2c = busio.I2C(board.SCL, board.SDA)
pca1 = PCA9685(i2c, address=0x40)
pca1.frequency = 50
pca2 = PCA9685(i2c, address=0x41)
pca2.frequency = 50

TARGET_ANGLES = {json.dumps(angles, indent=4)}

def set_mouth_energized(energized):
    """L298 Channel 1: Keeps mouth open as long as motor is energized."""
    if energized:
        GPIO.output(L298_IN1, GPIO.HIGH)
        GPIO.output(L298_IN2, GPIO.LOW)
        pwm_mouth.ChangeDutyCycle(100) # Full drive keeps mouth open
    else:
        pwm_mouth.ChangeDutyCycle(0)

def set_neck_pulsating(pulsating):
    """L298 Channel 2: Keeps neck pulsating as long as motor is energized."""
    if pulsating:
        GPIO.output(L298_IN3, GPIO.HIGH)
        GPIO.output(L298_IN4, GPIO.LOW)
        pwm_neck.ChangeDutyCycle(80)
    else:
        pwm_neck.ChangeDutyCycle(0)

def read_distance_cm(sensor_name):
    """Reads distance from one of the 4 HC-SR04 ultrasonic sensors."""
    pins = SENSORS.get(sensor_name)
    if not pins: return 0.0

    # Pulse Trig pin
    GPIO.output(pins["trig"], True)
    time.sleep(0.00001)
    GPIO.output(pins["trig"], False)

    start_time = time.time()
    stop_time = time.time()

    while GPIO.input(pins["echo"]) == 0:
        start_time = time.time()
        if start_time - stop_time > 0.03: break

    while GPIO.input(pins["echo"]) == 1:
        stop_time = time.time()

    elapsed = stop_time - start_time
    distance_cm = (elapsed * 34300) / 2
    return round(distance_cm, 1)

def main():
    print("Master Hexapod Controller Online.")
    print("L298 Channel 1 (Mouth) & Channel 2 (Neck) ready.")
    print("4x HC-SR04 Sensors initialized (Front, Rear, Left, Right).")

    # Example test pulse
    set_mouth_energized(True)
    set_neck_pulsating(True)
    time.sleep(2)
    set_mouth_energized(False)
    set_neck_pulsating(False)

    # Read distances
    for s in SENSORS:
        dist = read_distance_cm(s)
        print(f"Sensor {{s.upper()}}: {{dist}} cm")

if __name__ == "__main__":
    try:
        main()
    finally:
        GPIO.cleanup()
'''
        return script

class ThreadingReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    for i in range(1, len(sys.argv)):
        if sys.argv[i] == "--port" and i + 1 < len(sys.argv):
            PORT = int(sys.argv[i + 1])
        elif sys.argv[i] == "--host" and i + 1 < len(sys.argv):
            HOST = sys.argv[i + 1]

    display_host = "localhost" if HOST in ["", "0.0.0.0", "127.0.0.1"] else HOST
    print(f"Starting Multithreaded Hexapod Control Server on http://{display_host}:{PORT}")
    bind_host = "" if HOST == "0.0.0.0" else HOST
    with ThreadingReusableTCPServer((bind_host, PORT), HexapodRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
