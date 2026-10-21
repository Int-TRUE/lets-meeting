import board from '../../docs/design/assets/01-brand-and-entry.png';
import headMascot from '../assets/mascot-head-v2.png';
import homeMascot from '../assets/home-mascot.png';
import welcomeMascot from '../assets/mascot-welcome-hq.png';
import tabletMascot from '../assets/mascot-tablet-hq.png';
import { useId } from 'react';
// Keep the approved 3D artwork. The alpha filter only removes faint outer haze.
export function Mascot({
  small = false,
  pose = 'guide',
}: {
  small?: boolean;
  pose?: 'guide' | 'tablet' | 'home' | 'welcome';
}) {
  const filterId = `mascot-alpha-${useId()}`;
  const cleanAlpha = !small && (pose === 'welcome' || pose === 'home' || pose === 'tablet');
  return (
    <span className={small ? 'mascot mascot-logo' : `mascot mascot-${pose}`} aria-hidden="true">
      {cleanAlpha ? (
        <svg
          width="0"
          height="0"
          style={{ position: 'absolute', width: 0, height: 0 }}
          focusable="false"
        >
          <defs>
            <filter id={filterId} colorInterpolationFilters="sRGB">
              <feComponentTransfer>
                <feFuncA type="linear" slope="1.1" intercept="-0.1" />
              </feComponentTransfer>
            </filter>
          </defs>
        </svg>
      ) : null}
      <img
        src={
          small
            ? headMascot
            : pose === 'home'
              ? homeMascot
              : pose === 'welcome'
                ? welcomeMascot
                : pose === 'tablet'
                  ? tabletMascot
                  : board
        }
        alt=""
        draggable="false"
        style={cleanAlpha ? { filter: `url(#${filterId})` } : undefined}
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
