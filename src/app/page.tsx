"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import { soundEffects } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  Play,
  Pause,
  RotateCcw,
  PowerOff,
  Trophy,
  AlertCircle,
  Timer as TimerIcon,
  User,
  GraduationCap,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Medal,
  Flame,
} from "lucide-react";

// 블록 색상 타입 정의 (밝은 파스텔톤 계열)
type BlockColorType = "lightRed" | "lightOrange" | "lightYellow" | "lightBlue" | "lightGreen" | "lightPurple";

interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  colorType: BlockColorType;
  colorHex: string;
  borderColorHex: string;
  isTarget: boolean; // 연한 빨강인지 여부
  destroyed: boolean;
}

const COLOR_CONFIG: Record<BlockColorType, { name: string; hex: string; borderHex: string; isTarget: boolean }> = {
  lightRed: { name: "연한 빨강", hex: "#fecaca", borderHex: "#f87171", isTarget: true }, // 목표 블록 (30% 배치)
  lightOrange: { name: "연한 주황", hex: "#fed7aa", borderHex: "#fb923c", isTarget: false },
  lightYellow: { name: "연한 노랑", hex: "#fef08a", borderHex: "#facc15", isTarget: false },
  lightGreen: { name: "연한 녹색", hex: "#bbf7d0", borderHex: "#4ade80", isTarget: false },
  lightBlue: { name: "연한 파랑", hex: "#bae6fd", borderHex: "#38bdf8", isTarget: false },
  lightPurple: { name: "연한 보라", hex: "#e9d5ff", borderHex: "#c084fc", isTarget: false },
};

// 캔버스 가상 좌표 기준 크기
const CANVAS_WIDTH = 760;
const CANVAS_HEIGHT = 540;
const BRICK_ROWS = 5;
const BRICK_COLS = 8;
const TOTAL_BRICKS = BRICK_ROWS * BRICK_COLS; // 40개
const TARGET_CLEARED_REQUIRED = 3; // 연한 빨강 3개 제거 시 클리어

export default function BreakoutGame() {
  // 화면 상태: 'intro' | 'countdown' | 'playing' | 'paused' | 'success' | 'failed' | 'exit'
  const [gameState, setGameState] = useState<
    "intro" | "countdown" | "playing" | "paused" | "success" | "failed" | "exit"
  >("intro");

  // 사용자 및 제작자 정보
  const [playerName, setPlayerName] = useState("");
  const creatorDept = "경영학부";
  const creatorStudentId = "202301763";
  const creatorName = "임서균";

  // 게임 진행 정보
  const [lives, setLives] = useState(3);
  const [redClearedCount, setRedClearedCount] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalTimeStr, setFinalTimeStr] = useState("00:00");
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [saveStatusMsg, setSaveStatusMsg] = useState<string | null>(null);

  // 명예의 전당 Top 3 랭킹 데이터 상태
  const [top3Records, setTop3Records] = useState<Array<{ name: string; finishtime: string; seconds?: number }>>([]);
  const [isLoadingTop3, setIsLoadingTop3] = useState(false);

  // BGM 오디오 참조
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  // 구글 시트 중복 저장 방지 Ref (한 게임당 정확히 1회만 저장)
  const isRecordSavedRef = useRef<boolean>(false);

  // 캔버스 및 렌더링 루프 참조
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameId = useRef<number | null>(null);

  // 키 및 터치 입력 상태
  const keys = useRef<{ ArrowLeft: boolean; ArrowRight: boolean }>({
    ArrowLeft: false,
    ArrowRight: false,
  });

  // 터치 드래그 상태
  const isTouchDragging = useRef(false);

  // 게임 내부 물리 엔티티 상태 Ref
  const paddleRef = useRef({
    x: CANVAS_WIDTH / 2 - 55,
    y: CANVAS_HEIGHT - 35,
    width: 110,
    height: 14,
    speed: 8,
  });

  const ballRef = useRef({
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT - 50,
    radius: 7,
    dx: 4,
    dy: -4,
    speed: 5.5,
  });

  const bricksRef = useRef<Brick[]>([]);

  // 구글 앱스 스크립트 웹 앱 URL (클라이언트 또는 환경변수)
  const GOOGLE_SCRIPT_WEBAPP_URL = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || "";

  // Top 3 랭킹 가져오기 함수
  const fetchTop3Records = useCallback(async () => {
    try {
      setIsLoadingTop3(true);
      const res = await fetch("/api/record");
      const data = await res.json();
      if (data.success && Array.isArray(data.top3)) {
        setTop3Records(data.top3);
      }
    } catch (e) {
      console.error("Top 3 로드 실패:", e);
    } finally {
      setIsLoadingTop3(false);
    }
  }, []);

  // 페이지 마운트 시 Top 3 불러오기
  useEffect(() => {
    fetchTop3Records();
  }, [fetchTop3Records]);

  // 구글 스프레드시트에 게임 성공 기록 저장 (성공 시에만 1회 호출)
  const saveRecordToGoogleSheet = async (name: string, totalSec: number, formattedTime: string) => {
    if (isRecordSavedRef.current) {
      return;
    }
    isRecordSavedRef.current = true;

    try {
      setIsSavingRecord(true);
      setSaveStatusMsg("구글 시트에 기록 저장 중...");

      const res = await fetch("/api/record", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name,
          seconds: totalSec,
          finishtime: formattedTime,
        }),
      });

      const resData = await res.json();

      if (res.ok && resData.success) {
        setSaveStatusMsg("✓ 구글 시트에 성공적으로 저장되었습니다!");
        if (Array.isArray(resData.top3) && resData.top3.length > 0) {
          setTop3Records(resData.top3);
        } else {
          fetchTop3Records();
        }
      } else if (GOOGLE_SCRIPT_WEBAPP_URL) {
        await fetch(GOOGLE_SCRIPT_WEBAPP_URL, {
          method: "POST",
          mode: "no-cors",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: name,
            seconds: totalSec,
            finishtime: formattedTime,
          }),
        });
        setSaveStatusMsg("✓ 구글 시트로 기록 전송 완료!");
        setTimeout(() => fetchTop3Records(), 1500);
      } else {
        setSaveStatusMsg("※ .env.local에 NEXT_PUBLIC_GOOGLE_SCRIPT_URL 설정이 필요합니다.");
      }
    } catch (err) {
      console.error("구글 시트 저장 처리 중 예외:", err);
      if (GOOGLE_SCRIPT_WEBAPP_URL) {
        try {
          await fetch(GOOGLE_SCRIPT_WEBAPP_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, seconds: totalSec, finishtime: formattedTime }),
          });
          setSaveStatusMsg("✓ 구글 시트로 기록 전송 완료!");
          setTimeout(() => fetchTop3Records(), 1500);
          return;
        } catch {
          // 실패
        }
      }
      setSaveStatusMsg("기록 저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingRecord(false);
    }
  };

  // 시간 포맷팅 함수 (분:초)
  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // 벽돌 초기화 함수 (5행 × 8열 = 40개, 30% 연빨강 = 12개, 나머지 5색 랜덤 분배)
  const initBricks = useCallback(() => {
    const bricks: Brick[] = [];
    const redCount = Math.round(TOTAL_BRICKS * 0.3); // 12개
    const otherColors: BlockColorType[] = [
      "lightOrange",
      "lightYellow",
      "lightGreen",
      "lightBlue",
      "lightPurple",
    ];

    const colorPool: BlockColorType[] = [];
    for (let i = 0; i < redCount; i++) {
      colorPool.push("lightRed");
    }
    const remainingCount = TOTAL_BRICKS - redCount; // 28개
    for (let i = 0; i < remainingCount; i++) {
      colorPool.push(otherColors[i % otherColors.length]);
    }

    // 셔플
    for (let i = colorPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colorPool[i], colorPool[j]] = [colorPool[j], colorPool[i]];
    }

    const padding = 10;
    const offsetTop = 45;
    const offsetLeft = 20;
    const totalPaddingX = padding * (BRICK_COLS - 1);
    const brickWidth = (CANVAS_WIDTH - offsetLeft * 2 - totalPaddingX) / BRICK_COLS;
    const brickHeight = 22;

    let poolIdx = 0;
    for (let r = 0; r < BRICK_ROWS; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        const cType = colorPool[poolIdx++];
        const brickX = offsetLeft + c * (brickWidth + padding);
        const brickY = offsetTop + r * (brickHeight + padding);

        bricks.push({
          x: brickX,
          y: brickY,
          width: brickWidth,
          height: brickHeight,
          colorType: cType,
          colorHex: COLOR_CONFIG[cType].hex,
          borderColorHex: COLOR_CONFIG[cType].borderHex,
          isTarget: COLOR_CONFIG[cType].isTarget,
          destroyed: false,
        });
      }
    }
    bricksRef.current = bricks;
  }, []);

  // 공 및 패들 위치 초기화
  const resetBallAndPaddle = useCallback(() => {
    paddleRef.current.x = CANVAS_WIDTH / 2 - paddleRef.current.width / 2;
    paddleRef.current.y = CANVAS_HEIGHT - 35;

    ballRef.current.x = CANVAS_WIDTH / 2;
    ballRef.current.y = CANVAS_HEIGHT - 55;
    const angle = (Math.PI / 4) * (Math.random() > 0.5 ? 1 : -1) + (Math.random() * 0.2 - 0.1);
    const speed = ballRef.current.speed;
    ballRef.current.dx = speed * Math.sin(angle);
    ballRef.current.dy = -speed * Math.cos(angle);
  }, []);

  // 배경음악 제어
  const playBGM = useCallback(() => {
    if (!bgmRef.current) {
      bgmRef.current = new Audio("/Hyper_Speed_Run.mp3");
      bgmRef.current.loop = true;
      bgmRef.current.volume = 0.25;
    }
    bgmRef.current.play().catch(() => {});
  }, []);

  const pauseBGM = useCallback(() => {
    if (bgmRef.current) bgmRef.current.pause();
  }, []);

  const stopBGM = useCallback(() => {
    if (bgmRef.current) {
      bgmRef.current.pause();
      bgmRef.current.currentTime = 0;
    }
  }, []);

  // 타이머 작동
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (gameState === "playing") {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [gameState]);

  // 카운트다운 처리
  useEffect(() => {
    let countTimer: NodeJS.Timeout | null = null;
    if (gameState === "countdown") {
      if (countdown > 0) {
        soundEffects.playCountdown(false);
        countTimer = setTimeout(() => {
          setCountdown((prev) => prev - 1);
        }, 1000);
      } else {
        soundEffects.playCountdown(true);
        setGameState("playing");
        playBGM();
      }
    }
    return () => {
      if (countTimer) clearTimeout(countTimer);
    };
  }, [gameState, countdown, playBGM]);

  // 키보드 이벤트 리스너 (PC 방향키)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.key === "ArrowLeft") {
        keys.current.ArrowLeft = true;
      }
      if (e.code === "ArrowRight" || e.key === "ArrowRight") {
        keys.current.ArrowRight = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowLeft" || e.key === "ArrowLeft") {
        keys.current.ArrowLeft = false;
      }
      if (e.code === "ArrowRight" || e.key === "ArrowRight") {
        keys.current.ArrowRight = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 모바일 터치 드래그로 패들 이동 처리 함수
  const handleTouchMove = (clientX: number) => {
    if (gameState !== "playing" || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = CANVAS_WIDTH / rect.width;
    const relativeX = (clientX - rect.left) * scale;
    const newPaddleX = relativeX - paddleRef.current.width / 2;
    paddleRef.current.x = Math.max(0, Math.min(CANVAS_WIDTH - paddleRef.current.width, newPaddleX));
  };

  // 승리 폭죽 효과
  const triggerConfetti = () => {
    const duration = 3.5 * 1000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#3b82f6", "#f43f5e", "#10b981", "#fbbf24", "#a855f7"],
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#3b82f6", "#f43f5e", "#10b981", "#fbbf24", "#a855f7"],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  };

  // 게임 루프 (Canvas Rendering)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      if (gameState === "playing") {
        // 패들 이동 (방향키 및 온스크린 버튼 지원)
        if (keys.current.ArrowLeft) {
          paddleRef.current.x = Math.max(0, paddleRef.current.x - paddleRef.current.speed);
        }
        if (keys.current.ArrowRight) {
          paddleRef.current.x = Math.min(
            CANVAS_WIDTH - paddleRef.current.width,
            paddleRef.current.x + paddleRef.current.speed
          );
        }

        // 공 이동
        const ball = ballRef.current;
        const paddle = paddleRef.current;

        ball.x += ball.dx;
        ball.y += ball.dy;

        // 벽 충돌
        if (ball.x - ball.radius <= 0) {
          ball.x = ball.radius;
          ball.dx = -ball.dx;
        } else if (ball.x + ball.radius >= CANVAS_WIDTH) {
          ball.x = CANVAS_WIDTH - ball.radius;
          ball.dx = -ball.dx;
        }

        if (ball.y - ball.radius <= 0) {
          ball.y = ball.radius;
          ball.dy = -ball.dy;
        }

        // 패들 충돌
        if (
          ball.y + ball.radius >= paddle.y &&
          ball.y - ball.radius <= paddle.y + paddle.height &&
          ball.x >= paddle.x &&
          ball.x <= paddle.x + paddle.width &&
          ball.dy > 0
        ) {
          const hitOffset = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
          const maxBounceAngle = (Math.PI * 5) / 12;
          const bounceAngle = hitOffset * maxBounceAngle;

          ball.dx = ball.speed * Math.sin(bounceAngle);
          ball.dy = -ball.speed * Math.cos(bounceAngle);
          soundEffects.playPaddleHit();
        }

        // 블록 충돌
        for (const brick of bricksRef.current) {
          if (!brick.destroyed) {
            if (
              ball.x + ball.radius > brick.x &&
              ball.x - ball.radius < brick.x + brick.width &&
              ball.y + ball.radius > brick.y &&
              ball.y - ball.radius < brick.y + brick.height
            ) {
              brick.destroyed = true;
              soundEffects.playBrickHit(brick.isTarget);

              const prevX = ball.x - ball.dx;
              const prevY = ball.y - ball.dy;
              if (prevX + ball.radius <= brick.x || prevX - ball.radius >= brick.x + brick.width) {
                ball.dx = -ball.dx;
              } else {
                ball.dy = -ball.dy;
              }

              if (brick.isTarget) {
                setRedClearedCount((prev) => {
                  const updated = prev + 1;
                  if (updated >= TARGET_CLEARED_REQUIRED) {
                    const finalTime = formatTime(elapsedSeconds);
                    setFinalTimeStr(finalTime);
                    setGameState("success");
                    pauseBGM();
                    soundEffects.playVictory();
                    triggerConfetti();
                    // 게임 성공 시에만 구글 시트에 저장
                    saveRecordToGoogleSheet(playerName, elapsedSeconds, finalTime);
                  }
                  return updated;
                });
              }
              break;
            }
          }
        }

        // 바닥으로 떨어진 경우
        if (ball.y - ball.radius > CANVAS_HEIGHT) {
          setLives((prevLives) => {
            const nextLives = prevLives - 1;
            if (nextLives <= 0) {
              setGameState("failed");
              pauseBGM();
              soundEffects.playGameOver();
            } else {
              resetBallAndPaddle();
            }
            return nextLives;
          });
        }
      }

      // --- 화이트 캔버스 드로잉 ---
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      bgGrad.addColorStop(0, "#ffffff");
      bgGrad.addColorStop(1, "#f1f5f9");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // 은은한 라이트 그리드
      ctx.strokeStyle = "rgba(226, 232, 240, 0.7)";
      ctx.lineWidth = 1;
      for (let x = 0; x < CANVAS_WIDTH; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < CANVAS_HEIGHT; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      // 벽돌 렌더링
      bricksRef.current.forEach((b) => {
        if (!b.destroyed) {
          ctx.save();
          ctx.shadowColor = "rgba(0, 0, 0, 0.05)";
          ctx.shadowBlur = 4;
          ctx.shadowOffsetY = 2;

          ctx.fillStyle = b.colorHex;
          ctx.beginPath();
          ctx.roundRect(b.x, b.y, b.width, b.height, 5);
          ctx.fill();

          ctx.lineWidth = b.isTarget ? 2 : 1.5;
          ctx.strokeStyle = b.borderColorHex;
          ctx.stroke();

          if (b.isTarget) {
            ctx.fillStyle = "#ef4444";
            ctx.beginPath();
            ctx.arc(b.x + b.width / 2, b.y + b.height / 2, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      });

      // 패들 렌더링
      const p = paddleRef.current;
      ctx.save();
      ctx.fillStyle = "#2563eb";
      ctx.shadowColor = "rgba(37, 99, 235, 0.25)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.width, p.height, 7);
      ctx.fill();
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // 공 렌더링
      const ball = ballRef.current;
      ctx.save();
      ctx.fillStyle = "#f97316";
      ctx.shadowColor = "rgba(249, 115, 22, 0.35)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      animFrameId.current = requestAnimationFrame(render);
    };

    animFrameId.current = requestAnimationFrame(render);

    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [gameState, elapsedSeconds, pauseBGM, resetBallAndPaddle]);

  const handleStartGame = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!playerName.trim()) return;

    // 새 게임 시작 시 기록 저장 플래그 초기화
    isRecordSavedRef.current = false;
    setSaveStatusMsg(null);

    setLives(3);
    setRedClearedCount(0);
    setElapsedSeconds(0);
    setCountdown(3);
    initBricks();
    resetBallAndPaddle();
    setGameState("countdown");
  };

  const handleTogglePause = () => {
    if (gameState === "playing") {
      setGameState("paused");
      pauseBGM();
    } else if (gameState === "paused") {
      setGameState("playing");
      playBGM();
    }
  };

  const handleRestart = () => {
    isRecordSavedRef.current = false;
    setSaveStatusMsg(null);
    stopBGM();
    setGameState("intro");
  };

  const handleExitGame = () => {
    isRecordSavedRef.current = false;
    setSaveStatusMsg(null);
    stopBGM();
    setGameState("exit");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 via-sky-50/50 to-blue-50 text-slate-800 p-2 sm:p-4 font-sans select-none overflow-x-hidden">
      {/* 상단 헤더 */}
      <header className="mb-3 sm:mb-5 text-center px-2">
        <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 bg-clip-text text-transparent drop-shadow-sm">
          INU 벽돌깨기
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1 flex flex-wrap items-center justify-center gap-1.5 font-medium">
          <span className="text-blue-600 font-semibold">인천대학교 횃불이 에디션</span>
          <span className="hidden sm:inline">•</span>
          <span className="text-slate-600">연한 빨강 블록 3개를 격파하면 미션 클리어!</span>
        </p>
      </header>

      {/* 화면 1: 첫 화면 (반응형 카드 & 마스코트) */}
      {gameState === "intro" && (
        <Card className="w-full max-w-sm sm:max-w-md bg-white/95 border-slate-200/80 shadow-xl backdrop-blur-md mx-auto">
          <CardHeader className="text-center pb-2 pt-6 px-4 sm:px-6">
            <div className="flex justify-center mb-1">
              <div className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden border-4 border-amber-300 shadow-md shadow-amber-200/50 bg-amber-50">
                <Image
                  src="/Mascot.jpg"
                  alt="인천대학교 마스코트 횃불이"
                  fill
                  priority
                  className="object-cover"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 sm:space-y-5 px-4 sm:px-6">
            <form onSubmit={handleStartGame} className="space-y-3 sm:space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-blue-600" />
                  플레이어 이름
                </label>
                <Input
                  type="text"
                  placeholder="이름을 입력하세요 (예: 김인천)"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="bg-slate-50/80 border-slate-300 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500 text-sm sm:text-base py-4 sm:py-5 shadow-inner"
                  autoFocus
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={!playerName.trim()}
                className="w-full py-5 sm:py-6 text-base sm:text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25 transition-all transform active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <Play className="w-4 h-4 sm:w-5 sm:h-5 mr-2 fill-current" />
                게임 시작
              </Button>
            </form>

            {/* 제작자 정보 섹션 */}
            <div className="pt-3 sm:pt-4 border-t border-slate-100 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200/60 shadow-sm">
              <div className="flex items-center justify-center mb-1.5">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <GraduationCap className="w-4 h-4 text-indigo-600" />
                  제작자 정보
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-around gap-1 font-medium text-slate-700 text-[11px] sm:text-xs">
                <span>학과: <strong className="text-slate-900 font-semibold">{creatorDept}</strong></span>
                <span>학번: <strong className="text-slate-900 font-semibold">{creatorStudentId}</strong></span>
                <span>이름: <strong className="text-slate-900 font-semibold">{creatorName}</strong></span>
              </div>
            </div>

            {/* 안내 텍스트 */}
            <div className="text-[11px] sm:text-xs text-center text-slate-400 leading-tight">
              PC: 좌우 방향키 (←, →) | 모바일: 화면 터치 드래그 또는 버튼
            </div>
          </CardContent>
        </Card>
      )}

      {/* 화면 2: 게임 화면 (모바일/PC 반응형 대응) */}
      {gameState !== "intro" && gameState !== "exit" && (
        <div className="w-full max-w-[760px] flex flex-col items-center">
          {/* 상단 대시보드 (반응형 콤팩트 레이아웃) */}
          <div className="w-full flex flex-wrap items-center justify-between bg-white border border-slate-200 rounded-t-xl sm:rounded-t-2xl px-3 sm:px-5 py-2.5 shadow-md gap-2">
            {/* 플레이어 & 생명 */}
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="font-bold text-xs sm:text-sm text-slate-800 flex items-center gap-1 truncate max-w-[90px] sm:max-w-none">
                <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 flex-shrink-0" />
                {playerName}
              </span>
              <div className="flex items-center gap-0.5 sm:gap-1">
                {[1, 2, 3].map((val) => (
                  <Heart
                    key={val}
                    className={`w-4 h-4 sm:w-5 sm:h-5 transition-all ${
                      val <= lives
                        ? "text-rose-500 fill-rose-500 filter drop-shadow-sm"
                        : "text-slate-200 fill-slate-100"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* 타겟(연빨강) & 경과 시간 */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex items-center gap-1 bg-rose-50 px-2 sm:px-2.5 py-1 rounded-full border border-rose-200 shadow-sm text-[11px] sm:text-xs">
                <span className="font-semibold text-rose-700 hidden xs:inline">연한 빨강:</span>
                <Badge className="bg-rose-500 text-white text-[10px] sm:text-xs font-bold px-1.5 py-0">
                  {redClearedCount}/{TARGET_CLEARED_REQUIRED}
                </Badge>
              </div>

              <div className="flex items-center gap-1 bg-amber-50 px-2 sm:px-2.5 py-1 rounded-full border border-amber-200 text-[11px] sm:text-xs">
                <TimerIcon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-600" />
                <span className="font-mono font-extrabold text-amber-700 min-w-[36px] text-right">
                  {formatTime(elapsedSeconds)}
                </span>
              </div>
            </div>

            {/* 우측 상단 빠른 액션 버튼 */}
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTogglePause}
                disabled={gameState !== "playing" && gameState !== "paused"}
                className="h-7 sm:h-8 px-2 text-[11px] sm:text-xs font-semibold bg-white border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                {gameState === "paused" ? (
                  <Play className="w-3 h-3 fill-current text-emerald-600" />
                ) : (
                  <Pause className="w-3 h-3 text-amber-500" />
                )}
                <span className="ml-1 hidden xs:inline">{gameState === "paused" ? "계속" : "멈춤"}</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={handleRestart}
                className="h-7 sm:h-8 px-2 text-[11px] sm:text-xs font-semibold bg-white border-slate-200 hover:bg-blue-50 text-blue-600"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="ml-1 hidden xs:inline">다시 시작</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={handleExitGame}
                className="h-7 sm:h-8 px-2 text-[11px] sm:text-xs font-semibold bg-white border-slate-200 hover:bg-rose-50 text-rose-600"
              >
                <PowerOff className="w-3 h-3" />
                <span className="ml-1 hidden xs:inline">종료</span>
              </Button>
            </div>
          </div>

          {/* 캔버스 영역 (터치 드래그 지원 및 100% 비율 축소 지원) */}
          <div
            className="relative w-full border-x border-b border-slate-200 rounded-b-xl sm:rounded-b-2xl overflow-hidden shadow-xl bg-white touch-none"
            onTouchStart={(e) => {
              isTouchDragging.current = true;
              handleTouchMove(e.touches[0].clientX);
            }}
            onTouchMove={(e) => {
              if (isTouchDragging.current) {
                handleTouchMove(e.touches[0].clientX);
              }
            }}
            onTouchEnd={() => {
              isTouchDragging.current = false;
            }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="block w-full h-auto aspect-[760/540]"
            />

            {/* 카운트다운 오버레이 (3, 2, 1) */}
            {gameState === "countdown" && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-200 px-4 text-center">
                <span className="text-6xl sm:text-8xl font-black text-blue-600 animate-bounce tracking-widest drop-shadow-lg">
                  {countdown}
                </span>
                <p className="text-xs sm:text-base font-semibold text-slate-700 mt-2 sm:mt-4 bg-white/90 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full shadow-sm border border-slate-200">
                  준비하세요! 화면 터치 또는 하단 버튼으로 패들을 조종합니다.
                </p>
              </div>
            )}

            {/* 일시 정지 오버레이 */}
            {gameState === "paused" && (
              <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex flex-col items-center justify-center p-4">
                <Pause className="w-12 h-12 sm:w-16 sm:h-16 text-blue-600 mb-2 animate-pulse" />
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-3 sm:mb-4">게임 일시 정지</h2>
                <Button
                  onClick={handleTogglePause}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 sm:px-7 sm:py-2.5 shadow-lg shadow-blue-500/20 text-sm sm:text-base"
                >
                  <Play className="w-4 h-4 mr-2 fill-current" /> 게임 재개
                </Button>
              </div>
            )}

            {/* 미션 성공 모달 오버레이 */}
            {gameState === "success" && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-in zoom-in-95 duration-300">
                <div className="p-3 sm:p-4 rounded-full bg-amber-100 text-amber-500 mb-2 sm:mb-3 shadow-md border border-amber-200">
                  <Trophy className="w-10 h-10 sm:w-14 sm:h-14" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1.5 sm:mb-2">🎉 미션 완료! 🎉</h2>
                <p className="text-slate-600 mb-3 sm:mb-4 max-w-xs sm:max-w-sm font-medium text-xs sm:text-sm">
                  축하합니다, <strong className="text-blue-600">{playerName}</strong>님! 연한 빨강 블록 3개를 모두 격파했습니다!
                </p>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 px-4 sm:px-6 mb-4 sm:mb-5 shadow-sm">
                  <div className="text-center mb-3">
                    <span className="text-[11px] sm:text-xs text-slate-500 font-semibold block mb-0.5">내 클리어 시간 (분:초)</span>
                    <span className="text-3xl sm:text-4xl font-black font-mono text-blue-600 tracking-wider">
                      {finalTimeStr}
                    </span>
                    {saveStatusMsg && (
                      <span className="text-[11px] text-emerald-600 font-medium block mt-1 animate-pulse">
                        {saveStatusMsg}
                      </span>
                    )}
                  </div>

                  {/* 미션 성공 팝업 내 Top 3 명예의 전당 표시 */}
                  <div className="pt-3 border-t border-slate-200 text-left">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Trophy className="w-4 h-4 text-amber-500 fill-amber-500" />
                        최단 클리어 Top 3
                      </span>
                      <span className="text-[10px] text-slate-400">구글 시트 실시간 랭킹</span>
                    </div>

                    <div className="space-y-1.5">
                      {top3Records.length > 0 ? (
                        top3Records.slice(0, 3).map((r, i) => (
                          <div
                            key={i}
                            className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border ${
                              i === 0
                                ? "bg-amber-50 border-amber-200 font-bold text-amber-950"
                                : i === 1
                                ? "bg-slate-100 border-slate-200 font-semibold text-slate-800"
                                : "bg-orange-50 border-orange-200 font-medium text-orange-950"
                            }`}
                          >
                            <span className="flex items-center gap-2 truncate max-w-[140px] sm:max-w-[180px]">
                              <span
                                className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-black ${
                                  i === 0
                                    ? "bg-amber-400 text-white"
                                    : i === 1
                                    ? "bg-slate-400 text-white"
                                    : "bg-orange-400 text-white"
                                }`}
                              >
                                {i + 1}
                              </span>
                              <span className="truncate">{r.name}</span>
                            </span>
                            <span className="font-mono font-bold text-blue-600 text-xs">
                              {r.finishtime}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-2 bg-white rounded border border-dashed border-slate-200 text-slate-400 text-[11px]">
                          기록을 집계하는 중입니다...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 sm:gap-3">
                  <Button
                    onClick={handleRestart}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 sm:px-6 py-2 sm:py-2.5 shadow-md shadow-blue-500/20 text-xs sm:text-sm"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> 다시 시작
                  </Button>
                  <Button
                    onClick={handleExitGame}
                    variant="outline"
                    className="border-slate-300 text-slate-700 hover:bg-slate-100 text-xs sm:text-sm px-4 sm:px-6"
                  >
                    <PowerOff className="w-3.5 h-3.5 mr-1.5" /> 게임 종료
                  </Button>
                </div>
              </div>
            )}

            {/* 미션 실패 모달 오버레이 */}
            {gameState === "failed" && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 text-center animate-in zoom-in-95 duration-300">
                <div className="p-3 sm:p-4 rounded-full bg-rose-100 text-rose-500 mb-2 sm:mb-3 shadow-md border border-rose-200">
                  <AlertCircle className="w-10 h-10 sm:w-14 sm:h-14" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-black text-slate-900 mb-1.5 sm:mb-2">게임 미션 실패</h2>
                <p className="text-slate-600 mb-4 sm:mb-6 max-w-xs sm:max-w-sm font-medium text-xs sm:text-sm">
                  모든 생명을 잃었습니다. 다시 도전하여 횃불이를 도와주세요!
                </p>
                <div className="flex gap-2 sm:gap-3">
                  <Button
                    onClick={handleRestart}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 sm:px-6 py-2 sm:py-2.5 shadow-md shadow-rose-500/20 text-xs sm:text-sm"
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> 다시 시작
                  </Button>
                  <Button
                    onClick={handleExitGame}
                    variant="outline"
                    className="border-slate-300 text-slate-700 hover:bg-slate-100 text-xs sm:text-sm px-4 sm:px-6"
                  >
                    <PowerOff className="w-3.5 h-3.5 mr-1.5" /> 게임 종료
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 모바일 전용 온스크린 조작 버튼 (모바일 화면에서만 표시) */}
          <div className="flex md:hidden w-full items-center justify-between gap-4 mt-3 px-2">
            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1 py-3.5 bg-white border border-slate-200 rounded-xl shadow-md active:bg-blue-50 active:border-blue-400 text-slate-700 active:text-blue-600 font-bold text-sm touch-manipulation select-none"
              onTouchStart={() => {
                keys.current.ArrowLeft = true;
              }}
              onTouchEnd={() => {
                keys.current.ArrowLeft = false;
              }}
              onMouseDown={() => {
                keys.current.ArrowLeft = true;
              }}
              onMouseUp={() => {
                keys.current.ArrowLeft = false;
              }}
            >
              <ChevronLeft className="w-5 h-5 text-blue-600" />
              <span>왼쪽 이동</span>
            </button>

            <button
              type="button"
              className="flex-1 flex items-center justify-center gap-1 py-3.5 bg-white border border-slate-200 rounded-xl shadow-md active:bg-blue-50 active:border-blue-400 text-slate-700 active:text-blue-600 font-bold text-sm touch-manipulation select-none"
              onTouchStart={() => {
                keys.current.ArrowRight = true;
              }}
              onTouchEnd={() => {
                keys.current.ArrowRight = false;
              }}
              onMouseDown={() => {
                keys.current.ArrowRight = true;
              }}
              onMouseUp={() => {
                keys.current.ArrowRight = false;
              }}
            >
              <span>오른쪽 이동</span>
              <ChevronRight className="w-5 h-5 text-blue-600" />
            </button>
          </div>
        </div>
      )}

      {/* 화면 3: 게임 종료 화면 */}
      {gameState === "exit" && (
        <Card className="w-full max-w-sm sm:max-w-md bg-white border-slate-200 shadow-xl text-center p-4 sm:p-6 mx-auto">
          <CardHeader className="px-2">
            <div className="mx-auto w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-100 flex items-center justify-center mb-2 border border-slate-200">
              <PowerOff className="w-8 h-8 sm:w-10 sm:h-10 text-slate-500" />
            </div>
            <CardTitle className="text-xl sm:text-2xl font-bold text-slate-900">게임이 종료되었습니다</CardTitle>
            <CardDescription className="text-slate-500 mt-1.5 sm:mt-2 text-xs sm:text-sm font-medium">
              INU 벽돌깨기를 플레이해 주셔서 감사합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2 px-2">
            <Button
              onClick={handleRestart}
              className="w-full py-4 sm:py-5 text-sm sm:text-base font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20"
            >
              <RotateCcw className="w-4 h-4 mr-2" /> 메인 화면으로 돌아가기
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
