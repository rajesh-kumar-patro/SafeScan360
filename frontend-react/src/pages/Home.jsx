import React from "react";
import Header from "../components/Header";
import FeaturePart from "../components/FeaturePart";
import WorkingPart from "../components/WorkingPart";
import Video_demo from "../components/Video_demo"
import About from "../components/About"


export default function Home({ onOpenModal }) {

  return (
    <div className="space-y-16">

      {/* HERO SECTION */}
      <Header onOpenModal={onOpenModal} />

      {/* FEATURES SECTION */}
      <FeaturePart />

      {/* HOW IT WORKS SECTION */}
      <WorkingPart />

      <Video_demo/>
      <About/>

    </div>
  );
}