import { Component, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { INTRO_SAFETY_TIMEOUT_MS } from '../lib/startup-intro';

const INTRO_SOURCE = require('../assets/video/fastque-startup-intro.mp4');

// Matches the approved artwork's own near-black canvas (see apps/web/app/premium-header.css and
// the brand lockup's sampled background) so there is no visible seam around the letterboxed video
// — contentFit="contain" below can only preserve the video's aspect ratio by leaving bars on one
// axis, and those bars must read as "more of the same dark background", never a flash of white.
const INTRO_BACKDROP_COLOR = '#000000';

/**
 * FastQue V9 brand intro (P0 mobile app opening brand intro mission) — plays the owner-approved
 * clip once, full-screen, no chrome, then calls `onFinish` exactly once. Every failure path
 * (playback error, a timeout slightly longer than the clip's own ~6.25s runtime) also calls
 * `onFinish` — this component must never be the reason a cold launch gets stuck. Wrap it in
 * StartupIntroErrorBoundary (below) at the call site so a synchronous render/init failure falls
 * through too, not just an async playback error.
 */
export function StartupIntro({ onFinish }: { onFinish: () => void }) {
  const finishedRef = useRef(false);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  }

  const player = useVideoPlayer(INTRO_SOURCE, (p) => {
    p.loop = false;
    // "No audio requirement" — the intro never depends on sound, and starting muted avoids both
    // platforms' autoplay-with-audio restrictions silently blocking playback on cold launch.
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    const endSubscription = player.addListener('playToEnd', finish);
    const statusSubscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') finish();
    });
    const timeout = setTimeout(finish, INTRO_SAFETY_TIMEOUT_MS);
    return () => {
      endSubscription.remove();
      statusSubscription.remove();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <View style={styles.root}>
      <VideoView
        style={styles.video}
        player={player}
        nativeControls={false}
        requiresLinearPlayback
        contentFit="contain"
      />
    </View>
  );
}

interface BoundaryProps {
  onError: () => void;
  children: ReactNode;
}
interface BoundaryState {
  hasError: boolean;
}

/**
 * A native-module or player-initialization failure inside StartupIntro would otherwise crash
 * synchronously during render, which StartupIntro's own async event listeners can never catch.
 * This is the other half of "never trap a user on startup" — same `onError`/`onFinish` contract,
 * just for the render-time failure mode instead of the playback-time one.
 */
export class StartupIntroErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INTRO_BACKDROP_COLOR },
  video: { flex: 1 },
});
