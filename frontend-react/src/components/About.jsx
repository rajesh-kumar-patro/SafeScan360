import React from "react";
import { ShieldCheck, Eye, AlertTriangle, Brain } from "lucide-react";

const About = () => {
  return (
    <section id="about" className="bg-slate-50 py-20 px-6">

      <div className="max-w-7xl mx-auto">

        {/* HEADING */}
        <div className="text-center max-w-3xl mx-auto mb-14">


          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-slate-900 mb-5">
            Making Workplace Safety and
            <span className="text-blue-700"> Smarter</span>
          </h2>

          <p className="text-slate-600 leading-relaxed">
            SafeScan360 is an AI-powered workplace safety monitoring system
            that combines worker face verification with real-time PPE
            detection to help create safer industrial environments.
          </p>

        </div>


        {/* CONTENT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* LEFT */}
          <div>

            <h3 className="text-2xl font-semibold text-slate-900 mb-5">
              AI-Powered Safety Monitoring
            </h3>

            <p className="text-slate-600 leading-relaxed mb-5">
              SafeScan360 provides an automated safety monitoring approach
              by analyzing live camera feeds using computer vision and
              trained AI models. The system first verifies registered
              workers using face recognition before starting the PPE
              compliance check.
            </p>

            <p className="text-slate-600 leading-relaxed mb-6 ">
              After verification, the system checks four essential safety
              items — helmets, safety vests, gloves, and safety shoes.
              This helps identify whether workers are properly equipped
              and allows safety violations to be detected quickly.
            </p>

            <div className="flex items-center gap-3">

              <div className="p-3 bg-blue-100 rounded-xl">
                <ShieldCheck className="text-blue-600" size={25} />
              </div>

              <div>

                <h4 className="font-semibold text-slate-900">
                  Safer Workplaces
                </h4>

                <p className="text-sm text-slate-500">
                  Automated worker verification and PPE compliance monitoring.
                </p>

              </div>

            </div>

          </div>


          {/* RIGHT - FEATURES */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

            {/* REAL-TIME DETECTION */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">

              <div className="w-11 h-11 flex items-center justify-center bg-blue-100 rounded-xl mb-4">
                <Eye className="text-blue-600" size={22} />
              </div>

              <h4 className="text-lg font-semibold text-slate-900 mb-2">
                Real-Time Detection
              </h4>

              <p className="text-sm text-slate-600 leading-relaxed">
                Analyze live camera feeds to monitor workers and detect
                PPE compliance in real time.
              </p>

            </div>


            {/* WORKER VERIFICATION */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">

              <div className="w-11 h-11 flex items-center justify-center bg-red-100 rounded-xl mb-4">
                <AlertTriangle className="text-red-500" size={22} />
              </div>

              <h4 className="text-lg font-semibold text-slate-900 mb-2">
                Worker Verification
              </h4>

              <p className="text-sm text-slate-600 leading-relaxed">
                Verify registered workers using face recognition before
                starting the PPE monitoring process.
              </p>

            </div>


            {/* PPE COMPLIANCE */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">

              <div className="w-11 h-11 flex items-center justify-center bg-green-100 rounded-xl mb-4">
                <ShieldCheck className="text-green-600" size={22} />
              </div>

              <h4 className="text-lg font-semibold text-slate-900 mb-2">
                PPE Compliance
              </h4>

              <p className="text-sm text-slate-600 leading-relaxed">
                Automatically detect helmets, safety vests, gloves,
                and safety shoes to identify PPE compliance.
              </p>

            </div>


            {/* AI ANALYSIS */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">

              <div className="w-11 h-11 flex items-center justify-center bg-purple-100 rounded-xl mb-4">
                <Brain className="text-purple-600" size={22} />
              </div>

              <h4 className="text-lg font-semibold text-slate-900 mb-2">
                AI-Based Analysis
              </h4>

              <p className="text-sm text-slate-600 leading-relaxed">
                Uses computer vision and trained AI models to analyze
                worker identity and safety equipment efficiently.
              </p>

            </div>

          </div>

        </div>

      </div>

    </section>
  );
};

export default About;