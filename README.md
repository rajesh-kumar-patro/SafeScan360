# SafeScan360: AI-Powered Industrial Safety Platform

**SafeScan360** is a real-time computer vision system built to automate workplace safety monitoring and regulatory compliance. Powered by custom-trained YOLOv8 models and high-performance backend pipelines, SafeScan360 detects PPE violations, tracks hazardous environments, and delivers real-time safety alerts through an interactive web interface.

---

## Key Features

- **PPE Compliance Detection**: Detects mandatory safety gear including helmets/hard hats, safety vests, protective boots, and gloves in real-time.
- **Hazard & Fire/Smoke Detection**: Identifies workplace hazards, smoke, and fire risks to trigger instant automated safety alerts.
- **Multi-Object Tracking (MOT)**: Tracks individual workers and equipment across camera feeds to prevent duplicate alerts and evaluate duration of violations.
- **Interactive Dashboard**: Modern React-based frontend providing live video feeds, real-time bounding box visualizations, violation logging, and analytics.
- **Modular Microservice Architecture**: Decoupled FastAPI backend and React frontend for minimal inference latency and seamless hardware scaling.

---

## Tech Stack

- **Computer Vision & Deep Learning**: YOLOv8 (Ultralytics), OpenCV, PyTorch
- **Backend**: FastAPI, Python, WebSockets
- **Frontend**: React.js, Tailwind CSS
- **Deployment & Scripting**: Batch execution scripts (`run_backend.bat`, `run_frontend.bat`), Conda/Virtualenv

---

## Project Structure

```text
SafeScan360/
├── backend/                  # FastAPI service & inference pipelines
├── frontend-react/           # React dashboard UI
├── data/                     # Sample datasets and test feeds
├── models/                   # Model architectures and weights
├── best.pt                   # Trained model weights (PPE detection)
├── Fire_smoke.pt             # Specialized hazard detection model
├── yolov8n.pt                # Base YOLOv8 weights
├── requirements.txt          # Python dependencies
├── run_backend.bat           # Startup script for backend API
└── run_frontend.bat          # Startup script for React frontend


<img width="1440" height="780" alt="Image" src="https://github.com/user-attachments/assets/dcc3e8cb-f6a1-4bff-8da5-873eca609cc6" />
<img width="1440" height="900" alt="Image" src="https://github.com/user-attachments/assets/7519a7a7-83c7-49c6-a7ea-d5be3981777c" />
<img width="1440" height="900" alt="Image" src="https://github.com/user-attachments/assets/a876194b-2c8f-4811-ad90-f351af2ea91b" />
<img width="1440" height="900" alt="Image" src="https://github.com/user-attachments/assets/019dbec4-2fe1-47af-9b0a-a6021da4e3db" />
<img width="1440" height="780" alt="Image" src="https://github.com/user-attachments/assets/c0c88d30-2430-46d6-a1eb-2919b898765e" />
