import React from "react";
import { ArrowRight } from "lucide-react";
import video from "../assets/annotated_video-2.mp4";
// import img from "../assets/logo.png";

export default function Header({ onOpenModal }) {
  return (
    <section
      id="home"
className="bg-blue-50 max-w-7xl mx-auto px-2 py-10 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center"
    >
      {/* LEFT CONTENT */}
      <div className="lg:col-span-7 space-y-6">

        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold text-slate-900 tracking-tight leading-[1.15]">
          Smart Safety Gear <br />

          <span className="text-blue-700">
            Detection System
          </span>
        </h2>

        <p className="text-slate-600 text-base max-w-xl font-normal leading-relaxed">
          Autonomous computer vision system that inspects workplace safety
          in real time. Reliably verifies helmets, safety vests, boots,
          and triggers instant alerts on active hazards and non-compliance.
        </p>

        {/* BUTTONS */}
        <div className="flex flex-wrap items-center gap-4 pt-2">

          <button
            onClick={onOpenModal}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 font-medium text-sm text-white rounded-xl shadow-lg shadow-blue-600/30 transition flex items-center gap-2"
          >
            Start Detection
            <ArrowRight size={16} />
          </button>

          <a
            href="#how-it-works"
            className="px-5 py-3 bg-white hover:bg-slate-100 border border-slate-300 text-sm font-semibold rounded-xl text-slate-700 shadow-sm transition"
          >
            How It Works
          </a>

        </div>

        {/* STATS */}
        <div className="pt-6 border-t border-slate-200 grid grid-cols-3 gap-6 max-w-md">

          <div>
            <div className="text-2xl font-black text-slate-900">
              YOLOv8
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Model Uses
            </div>
          </div>

          <div>
            <div className="text-2xl font-black text-blue-600">
              24/7
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Real-Time Monitoring
            </div>
          </div>

          <div>
            <div className="text-2xl font-black text-emerald-600">
              &lt; 40ms
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Detection Latency
            </div>
          </div>

        </div>
      </div>

      {/* RIGHT VIDEO CARD */}
      <div className="lg:col-span-5">

        <div className="rounded-xl border border-blue-900/20 bg-gradient-to-br from-blue-700 to-blue-950 text-white shadow-2xl p-6 space-y-5">

<video src={video}></video>

          {/* VIDEO STATS */}
          <div className="grid grid-cols-2 gap-3 text-xs">

            <div className="p-3 rounded-xl bg-blue-900/60 border border-blue-800">

              <span className="text-blue-200">
                Model Accuracy
              </span>

              <div className="text-base font-black text-white mt-0.5">
                90.2%
              </div>

            </div>

            <div className="p-3 rounded-xl bg-blue-900/60 border border-blue-800">

              <span className="text-blue-200">
                Target Speed
              </span>

              <div className="text-base font-black text-blue-300 mt-0.5">
                38 FPS
              </div>

            </div>

          </div>

        </div>

      </div>
    </section>
  );
}