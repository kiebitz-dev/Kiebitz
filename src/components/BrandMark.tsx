import type { CSSProperties } from "react";
import { Bird } from "lucide-react";
import { activeEvent } from "../events";

/**
 * Die Marke · der Vogel in seinem Feld, in einem Event-Build das Logo des Events.
 *
 * Das Event-Logo ist eine fertige Kachel mit eigenem Grund und eigener
 * Rundung (transparente Ecken). Es nimmt deshalb nur Größe und Abstände aus
 * `className`; Grund, Rand und Rundung des Felds fallen weg, sonst stünden
 * hinter den runden Ecken die eckigen des Felds. Hat der Event-Ordner kein
 * Logo, bleibt es beim Vogel.
 */
export default function BrandMark({
  className,
  style,
  icon,
}: {
  /** Feld samt Größe, Grund und Rundung · gilt für beide Fassungen. */
  className: string;
  style?: CSSProperties;
  /** Größe des Vogels im Feld. */
  icon: number;
}) {
  const logo = activeEvent()?.logo;
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        draggable={false}
        className={className}
        style={{ ...style, objectFit: "contain", background: "none", border: 0, borderRadius: 0 }}
      />
    );
  }
  return (
    <span className={className} style={style}>
      <Bird size={icon} />
    </span>
  );
}
