import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LivingBackground } from './LivingBackground';
import { Camera, CameraMove } from './Camera';
import { Theme } from './getSceneStyles';

/* One wrapper every scene adopts instead of a flat backgroundColor fill: the
   living background (behind, on the GLOBAL frame so it doesn't reset at cuts) +
   the moving camera around the content. The bg drifts on its own clock while the
   content rides the camera ⇒ parallax depth. */
export const SceneFrame = ({
  theme, move = 'push-in', origin = '50% 50%', dur = 90, startFrame = 0, pad = 110, children,
}: { theme?: Theme; move?: CameraMove; origin?: string; dur?: number; startFrame?: number; pad?: number; children: any }) => {
  const globalFrame = startFrame + useCurrentFrame();
  return (
    <AbsoluteFill>
      <LivingBackground theme={theme} frame={globalFrame} />
      <Camera move={move} dur={dur} origin={origin}>
        <AbsoluteFill style={{ justifyContent: 'center', padding: pad }}>{children}</AbsoluteFill>
      </Camera>
    </AbsoluteFill>
  );
};
