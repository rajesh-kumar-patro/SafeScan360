import React from "react";
import {
  ShieldCheck,
  Activity,
  UserCheck,
  HardHat,
  Shirt,
  Hand,
  Footprints,
  ArrowRight,
} from "lucide-react";

import video from "../assets/video-3.mp4";

export default function Header({ onOpenModal }) {
  const ppeItems = [
    {
      icon: UserCheck,
      title: "Face",
      subtitle: "Verified",
    },
    {
      icon: HardHat,
      title: "Helmet",
      subtitle: "Detected",
    },
    {
      icon: Shirt,
      title: "Vest",
      subtitle: "Detected",
    },
    {
      icon: Hand,
      title: "Gloves",
      subtitle: "Detected",
    },
    {
      icon: Footprints,
      title: "Shoes",
      subtitle: "Detected",
    },
  ];

  return (
    <section id="home" className="relative overflow-hidden bg-slate-50">
      {/* BACKGROUND GLOW */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-0 -left-40 w-96 h-96 bg-cyan-100/30 rounded-full blur-3xl" />

      <div className="relative max-w-7xl mx-auto px-6 py-14 lg:py-20">

        {/* ================================================= */}
        {/* MAIN GRID */}
        {/* LEFT = DEMO / RIGHT = CONTENT */}
        {/* ================================================= */}

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-center">

          {/* ================================================= */}
          {/* LEFT : DEMO BOX */}
          {/* ================================================= */}

          <div className="order-1">

            <div className="relative rounded-xl bg-[#071A35] p-3 sm:p-4 shadow-2xl shadow-blue-900/20 border border-blue-900/30">

  

              {/* VIDEO */}
              <div className="relative overflow-hidden rounded-xl bg-black aspect-video">

                <video
                  src={video}
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                  className="w-full h-full object-cover"
                />

                {/* LIVE BADGE */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md text-white text-[10px] font-bold">

                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />

                  LIVE

                </div>

                {/* AI BADGE */}


              </div>

              {/* DETECTION STATUS */}
              <div className="grid grid-cols-2 gap-2.5 mt-3">

                {/* ACCURACY */}
                <div className="rounded-xl bg-[#0B2852] border border-blue-400/10 p-3">

                  <div className="flex items-center gap-2 text-blue-300 text-[10px] font-medium">

                    <ShieldCheck size={14} />

                    MODEL ACCURACY

                  </div>

                  <div className="mt-1 text-xl font-black text-white">
                    90.2%
                  </div>

                </div>

                {/* SPEED */}
                <div className="rounded-xl bg-[#0B2852] border border-cyan-400/10 p-3">

                  <div className="flex items-center gap-2 text-cyan-300 text-[10px] font-medium">

                    <Activity size={14} />

                    DETECTION SPEED

                  </div>

                  <div className="mt-1 text-xl font-black text-white">

                    40{" "}

                    <span className="text-xs text-cyan-400">
                      FPS
                    </span>

                  </div>

                </div>

              </div>

              {/* VERIFICATION BAR */}
              <div className="mt-3 flex items-center justify-between rounded-xl bg-green-500/10 border border-green-400/10 px-4 py-3">

                <div className="flex items-center gap-2">

                  <div className="w-7 h-7 rounded-lg bg-green-500/15 flex items-center justify-center">

                    <UserCheck
                      size={15}
                      className="text-green-400"
                    />

                  </div>

                  <div>

                    <div className="text-xs font-bold text-white">
                      Worker Verified
                    </div>

                    <div className="text-[10px] text-green-400">
                      PPE compliance confirmed
                    </div>

                  </div>

                </div>

                <span className="text-[10px] font-bold text-green-400">
                  VERIFIED
                </span>

              </div>

            </div>

          </div>


          {/* ================================================= */}
          {/* RIGHT : CONTENT */}
          {/* ================================================= */}

          <div className="order-2 space-y-6">




            {/* TITLE */}
            <div>

              <h1 className="text-4xl sm:text-5xl lg:text-[50px] leading-[1.08] font-black tracking-tight text-slate-900">

                Smart Safety

                <br />

                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-cyan-500">

                  Detection Demo

                </span>

              </h1>

              <p className="mt-5 max-w-xl text-slate-600 text-base lg:text-lg leading-7">

                AI-powered computer vision that verifies workers,
                detects PPE compliance, and monitors industrial
                safety in real time.

              </p>

            </div>


            {/* PPE CHECKS */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-w-xl">

              {ppeItems.map((item) => {

                const Icon = item.icon;

                return (

                  <div
                    key={item.title}
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm"
                  >

                    <div className="w-8 h-8 shrink-0 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">

                      <Icon size={16} />

                    </div>

                    <div className="min-w-0">

                      <div className="text-xs font-bold text-slate-900">
                        {item.title}
                      </div>

                      <div className="text-[10px] text-green-600 font-medium">
                        {item.subtitle}
                      </div>

                    </div>

                  </div>

                );

              })}

            </div>





     

          </div>

        </div>

      </div>

    </section>
  );
}