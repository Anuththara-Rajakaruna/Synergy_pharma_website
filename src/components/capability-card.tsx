import Image from "next/image";
import { LucideIcon } from "lucide-react";

interface CapabilityCardProps {
  title: string;
  description: string;
  label: string;
  image: string;
  imageAlt: string;
  accent?: "blue" | "teal";
  icon?: LucideIcon;
}

export function CapabilityCard({
  title,
  description,
  label,
  image,
  imageAlt,
  accent = "blue",
  icon: Icon,
}: CapabilityCardProps) {
  return (
    <article
      className={`laboratoryCard accent${accent[0].toUpperCase()}${accent.slice(1)}`}
    >
      <div className="laboratory-card-image-wrap">
        <Image src={image} alt={imageAlt} fill className="laboratory-card-image" />
      </div>
      <div className="laboratory-card-overlay">
        <h3>{title}</h3>
        <p>{description}</p>
        <small>{label}</small>
      </div>
    </article>
  );
}
