# Sonic Jam 🎵

A modern, web-based music player that streams audio directly from YouTube links and features a real-time, 3D WebGL "Radial Halo" audio visualizer. 

The project is split into two parts: a **FastAPI Backend** (which acts as a proxy to extract YouTube streams and bypass CORS) and a **React + Three.js Frontend** (for the UI and 3D visualizer).

---

## 🚀 How to Run the Project Locally

If you are cloning this project for the first time, follow these steps to get both the backend and frontend running.

### Prerequisites
Make sure you have the following installed on your machine:
*   **Python 3.9+** (For the backend server)
*   **Node.js (v18+)** (For the frontend React app)

---

### 1️⃣ Set up the Backend (FastAPI + yt-dlp)

The backend handles extracting the raw audio stream from YouTube.

1. Open a terminal and navigate into the `backend` folder:
   ```bash
   cd sonic-jam/backend
   ```
2. Create a virtual environment to hold the Python dependencies:
   ```bash
   python -m venv venv
   ```
3. Activate the virtual environment:
   * **Windows (PowerShell):** `.\venv\Scripts\activate`
   * **Mac/Linux:** `source venv/bin/activate`
4. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
5. Start the backend server:
   ```bash
   uvicorn main:app --reload
   ```
   *The server should now be running on `http://127.0.0.1:8000`*

---

### 2️⃣ Set up the Frontend (React + Vite + Three.js)

The frontend handles the music playback and the 3D visualizer.

1. Open a **new** terminal (leave the backend running) and navigate into the `frontend` folder:
   ```bash
   cd sonic-jam/frontend
   ```
2. Install the necessary Node modules:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   *The app should now be running. The terminal will give you a local link (usually `http://localhost:5173`).*

---

## 🎧 Usage
1. Open the frontend link (`http://localhost:5173`) in your web browser.
2. Paste any valid YouTube URL (or YouTube Music URL) into the search bar.
3. Click "Search" and wait 2-3 seconds for the backend to extract the stream.
4. Enjoy the music and watch the 3D Radial Halo react to the frequencies! The background color will automatically shift based on the "Spectral Centroid" (the energy and type) of the song you play.

## 🛠️ Tech Stack
*   **Backend:** Python, FastAPI, Uvicorn, yt-dlp, httpx
*   **Frontend:** React, Vite, Three.js, React Three Fiber, Lucide React
