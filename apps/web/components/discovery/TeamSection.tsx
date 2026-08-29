import type { TeamMemberDto } from "@barbercue/shared";
import { SalonImage } from "../ui/SalonImage";
import styles from "./discovery-content.module.css";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  BARBER: "Barber",
};

/**
 * Phase 17 (Barber Professional Profile) — "Meet the team" on a salon's public discovery page.
 * Only ACTIVE staff (filtered server-side, see SalonsService.getProfile). Renders nothing at all
 * (not an empty-state card) when a shop hasn't set up any staff yet — a bare roster grid full of
 * "no photo yet" placeholders would look broken, not honest, on an otherwise complete profile.
 */
export function TeamSection({ team }: { team: TeamMemberDto[] }) {
  if (team.length === 0) return null;
  return (
    <div className={styles.teamGrid}>
      {team.map((member) => (
        <article key={member.id} className={styles.teamCard}>
          <div className={styles.teamPhoto}>
            <SalonImage url={member.photoUrl} alt={member.displayName} aspectRatio="1 / 1" rounded={12} />
          </div>
          <p className={styles.teamName}>{member.displayName}</p>
          <p className={styles.teamMeta}>
            {ROLE_LABEL[member.roleInSalon] ?? member.roleInSalon}
            {member.yearsExperience !== null &&
              ` · ${member.yearsExperience} yr${member.yearsExperience === 1 ? "" : "s"} experience`}
          </p>
          {member.bio && <p className={styles.teamBio}>{member.bio}</p>}
        </article>
      ))}
    </div>
  );
}
