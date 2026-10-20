import board from '../../docs/design/assets/01-brand-and-entry.png';
import headMascot from '../assets/mascot-head-v2.png';
import homeMascot from '../assets/home-mascot.png';
// Clip only the approved character from the supplied board; never render a screen as UI.
export function Mascot({
  small = false,
  pose = 'guide',
}: {
  small?: boolean;
  pose?: 'guide' | 'tablet' | 'home' | 'welcome';
}) {
  return (
    <span className={small ? 'mascot mascot-logo' : `mascot mascot-${pose}`} aria-hidden="true">
      <img
        src={small ? headMascot : pose === 'home' ? homeMascot : board}
        alt=""
        draggable="false"
      />
    </span>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <Mascot small />
      <span>
        <strong>로봇집사</strong>
        <small>ROBOT BUTLER</small>
      </span>
    </span>
  );
}
