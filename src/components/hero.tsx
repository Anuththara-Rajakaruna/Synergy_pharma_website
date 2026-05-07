import React from "react";
import "./hero.css";

export interface HeroProps {
  eyebrow: string;
  heading: string;
  description: string;
  actions?: React.ReactNode;
  showGradients?: boolean;
  className?: string;
  leftGradientSrc?: string;
  rightGradientSrc?: string;
}

export const Hero: React.FC<HeroProps> = ({
  eyebrow,
  heading,
  description,
  actions,
  showGradients = true,
  className = "",
  leftGradientSrc = "/left-grad.svg",
  rightGradientSrc = "/right-grad.svg",
}) => {
  return (
    <section className={`hero ${className}`}>
      {showGradients && (
        <>
          <img
            src={leftGradientSrc}
            alt=""
            className="gradient-decorator gradient-decorator-left"
          />
          <img
            src={rightGradientSrc}
            alt=""
            className="gradient-decorator gradient-decorator-right"
          />
        </>
      )}
      <div className="container hero-content">
        <p className="hero-eyebrow">{eyebrow}</p>
        <h1>{heading}</h1>
        <p>{description}</p>
        {actions}
      </div>
    </section>
  );
};
