import React from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  UserCheck,
  HardHat,
  Activity,
  Mail,
  MapPin,
} from "lucide-react";
import img from "../assets/ppe-logo.png";

export default function Footer() {
  return (
    <footer
      id="footer"
      className="bg-[#06152D] text-white border-t border-blue-900/40"
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-14">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10">

          {/* BRAND */}
          <div className="md:col-span-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-400/20 flex items-center justify-center p-1.5 shadow-lg shadow-blue-900/20">
  <img
    src={img}
    alt="SafeScan360"
    className="w-full h-full object-contain"
  />
</div>
              <div>
                <h3 className="font-black text-xl tracking-wide">
                  SafeScan<span className="text-blue-400">360</span>
                </h3>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                  AI Safety Monitoring
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-400 leading-relaxed max-w-md">
              An AI-powered industrial safety monitoring system that verifies
              workers and automatically detects PPE compliance in real time
              using computer vision.
            </p>


        
          </div>

          {/* SYSTEM */}
          <div className="md:col-span-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-5">
              Safety System
            </h4>

            <ul className="space-y-3 text-sm text-slate-400">
              <li className="flex items-center gap-2">
                <UserCheck size={15} className="text-blue-400" />
                Worker Verification
              </li>

              <li className="flex items-center gap-2">
                <HardHat size={15} className="text-blue-400" />
                PPE Detection
              </li>

              <li className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-blue-400" />
                PPE Compliance
              </li>

              <li className="flex items-center gap-2">
                <Activity size={15} className="text-blue-400" />
                Real-Time Monitoring
              </li>
            </ul>
          </div>

          {/* NAVIGATION */}
          <div className="md:col-span-2">
            <h4 className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-5">
              Navigation
            </h4>

            <ul className="space-y-3 text-sm text-slate-400">
              <li>
                <Link
                  to="/"
                  className="hover:text-white transition-colors"
                >
                  Home
                </Link>
              </li>

              <li>
                <Link
                  to="/image"
                  className="hover:text-white transition-colors"
                >
                  Image Audit
                </Link>
              </li>

              <li>
                <Link
                  to="/live"
                  className="hover:text-white transition-colors"
                >
                  Live Camera
                </Link>
              </li>

              <li>
                <Link
                  to="/video"
                  className="hover:text-white transition-colors"
                >
                  Video Audit
                </Link>
              </li>
            </ul>
          </div>

          {/* CONTACT */}
          <div className="md:col-span-2">
            <h4 className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-5">
              System Info
            </h4>

            <div className="space-y-4 text-sm text-slate-400">
              <div className="flex items-start gap-2">
                <ShieldCheck
                  size={16}
                  className="text-cyan-400 mt-0.5 shrink-0"
                />
                <span>
                  AI-powered
                  <br />
                  workplace safety
                </span>
              </div>

              <div className="flex items-start gap-2">
                <Activity
                  size={16}
                  className="text-cyan-400 mt-0.5 shrink-0"
                />
                <span>
                  Real-time
                  <br />
                  monitoring
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM */}
        <div className="mt-12 pt-6 border-t border-blue-900/40 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[11px] text-slate-500 text-center md:text-left">
            © 2026 SafeScan360. AI-Powered Industrial Safety Monitoring.
          </p>


        </div>
      </div>
    </footer>
  );
}