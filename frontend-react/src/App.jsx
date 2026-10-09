import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import DetectionModal from './components/DetectionModal';
import Home from './pages/Home';
import ImageDetection from './pages/ImageDetection';
import LiveDetection from './pages/LiveDetection';
import VideoAudit from './pages/VideoAudit';
import IncidentArchive from './pages/IncidentArchive';
import Dashboard from './pages/Dashboard';
import Analytics from "./pages/Analytics";
import WorkVerification from "./pages/WorkVerification";
import RegisterWorker from "./pages/RegisterWorker";
import RegisteredWorkers from "./pages/RegisteredWorkers";
import PpeAlerts from "./pages/PpeAlerts";
import SafetyMap from "./pages/SafetyMap";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Welcome from "./pages/Welcome";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";

// Shown for a moment while we ask the backend whether the browser already has a valid session.
function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm font-bold text-slate-400">
      Loading SafeScan360…
    </div>
  );
}

// Everything the user can see. Logged out: only Welcome / Sign In / Sign Up.
// Logged in: the existing application, unchanged.
function AppRoutes() {
  const { user, loading } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  if (loading) return <Splash />;

  if (!user) {
    return (
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        {/* any other URL (dashboard, live, ...) is not reachable without signing in */}
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <div className="bg-slate-50 text-slate-900 min-h-screen flex flex-col justify-between">
        <Navbar onOpenModal={() => setModalOpen(true)} />
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<Home onOpenModal={() => setModalOpen(true)} />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/image" element={<ImageDetection />} />
            <Route path="/live" element={<LiveDetection />} />
            <Route path="/video" element={<VideoAudit />} />
            <Route path="/incident-archive" element={<IncidentArchive />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/verify" element={<WorkVerification />} />
            <Route path="/register-worker" element={<RegisterWorker />} />
            <Route path="/workers" element={<RegisteredWorkers />} />
            <Route path="/alerts" element={<PpeAlerts />} />
            <Route path="/safety-map" element={<SafetyMap />} />
            {/* already signed in -> the auth screens just lead back to the dashboard */}
            <Route path="/welcome" element={<Navigate to="/dashboard" replace />} />
            <Route path="/signin" element={<Navigate to="/dashboard" replace />} />
            <Route path="/signup" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
        <Footer />
        <DetectionModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}