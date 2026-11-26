import { useEffect, useRef } from "react";

let youtubeAPI;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  youtubeAPI ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => fail(), 12_000);
    function cleanup() {
      clearTimeout(timeout);
      window.onYouTubeIframeAPIReady = previous;
    }
    function fail() {
      cleanup();
      script.remove();
      youtubeAPI = null;
      reject(Error("YouTube player unavailable."));
    }
    window.onYouTubeIframeAPIReady = () => {
      cleanup();
      resolve(window.YT);
      if (typeof previous === "function") previous();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return youtubeAPI;
}

export default function JukeboxVideo({ video, onReport }) {
  const slot = useRef(null);
  const report = useRef(onReport);
  report.current = onReport;
  const { id, attempt } = video;

  useEffect(() => {
    let disposed = false,
      visible = false,
      started = false,
      readyPlayer,
      player;
    const container = slot.current;
    const frame = document.createElement("iframe");
    const src = new URL(
      `https://www.youtube.com/embed/${encodeURIComponent(id)}`,
    );
    src.search = new URLSearchParams({
      enablejsapi: "1",
      origin: location.origin,
      playsinline: "1",
      rel: "0",
    });
    frame.src = src.href;
    frame.title = "YouTube music player";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    container.append(frame);

    const notify = (state) => {
      if (!disposed) report.current(attempt, state);
    };
    function playWhenVisible() {
      if (disposed || !readyPlayer || !visible || document.hidden || started)
        return;
      started = true;
      readyPlayer.playVideo();
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.intersectionRatio >= 0.51;
        playWhenVisible();
      },
      { threshold: 0.51 },
    );
    observer.observe(frame);
    document.addEventListener("visibilitychange", playWhenVisible);

    loadYouTube()
      .then((api) => {
        if (disposed) return;
        player = new api.Player(frame, {
          events: {
            onReady(event) {
              readyPlayer = event.target;
              playWhenVisible();
            },
            onStateChange(event) {
              if (event.data === api.PlayerState.PLAYING) notify("playing");
              if (event.data === api.PlayerState.ENDED) notify("ended");
            },
            onError: () => notify("error"),
          },
        });
      })
      .catch(() => notify("error"));

    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", playWhenVisible);
      player?.destroy();
      frame.remove();
    };
  }, [id, attempt]);

  return (
    <aside className="jukebox-video" ref={slot} aria-label="Music video" />
  );
}
