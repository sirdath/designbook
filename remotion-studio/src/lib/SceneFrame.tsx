import { AbsoluteFill } from 'remotion';
import { Camera, CameraMove } from './Camera';
import { Theme } from './getSceneStyles';

/* One wrapper every scene adopts: the moving camera around the content, over a
   TRANSPARENT fill so the shared evolving ShaderBackground (rendered once at the
   composition root) shows through continuously. `startFrame`/`theme` are kept for
   API compatibility (scenes still pass them). */
export const SceneFrame = ({
  move = 'push-in', origin = '50% 50%', dur = 90, pad = 110, children,
}: { theme?: Theme; move?: CameraMove; origin?: string; dur?: number; startFrame?: number; pad?: number; children: any }) => {
  return (
    <AbsoluteFill>
      <Camera move={move} dur={dur} origin={origin}>
        <AbsoluteFill style={{ justifyContent: 'center', padding: pad }}>{children}</AbsoluteFill>
      </Camera>
    </AbsoluteFill>
  );
};
