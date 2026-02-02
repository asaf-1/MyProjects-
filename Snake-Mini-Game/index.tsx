import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

type Coord = { x: number; y: number };
type Buff = "none" | "slow" | "fast";

const CELL_SIZE = 20;
const WIDTH = window.innerWidth - (window.innerWidth % CELL_SIZE);
const HEIGHT = window.innerHeight - (window.innerHeight % CELL_SIZE);
const COLS = WIDTH / CELL_SIZE;
const ROWS = HEIGHT / CELL_SIZE;

const START_SPEED = 200;

function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snake, setSnake] = useState<Coord[]>([{ x: 5, y: 5 }]);
  const [dir, setDir] = useState<Coord>({ x: 1, y: 0 });
  const [food, setFood] = useState<Coord | null>(null);
  const [buff, setBuff] = useState<Buff>("none");
  const [buffTimeout, setBuffTimeout] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [speed, setSpeed] = useState(START_SPEED);

  const spawnFood = () => {
    let newFood: Coord;
    do {
      newFood = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS),
      };
    } while (snake.some((s) => s.x === newFood.x && s.y === newFood.y));
    setFood(newFood);

    if (Math.random() < 0.3) {
      const randomBuff = Math.random() < 0.5 ? "slow" : "fast";
      setBuff(randomBuff);
      setBuffTimeout(Date.now() + 5000);
    } else {
      setBuff("none");
    }
  };

  const resetGame = () => {
    setSnake([{ x: 5, y: 5 }]);
    setDir({ x: 1, y: 0 });
    setScore(0);
    setSpeed(START_SPEED);
    setBuff("none");
    setBuffTimeout(0);
    spawnFood();
    setRunning(false);
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Draw food
    if (food) {
      ctx.fillStyle =
        buff === "fast" ? "#f87171" : buff === "slow" ? "#60a5fa" : "#4ade80";
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2;
      ctx.fillRect(food.x * CELL_SIZE, food.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.strokeRect(food.x * CELL_SIZE, food.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }

    // Draw snake
    ctx.fillStyle = "#facc15";
    snake.forEach((segment) => {
      ctx.fillRect(segment.x * CELL_SIZE, segment.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    });
  }, [snake, food, buff]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowUp":
          setDir((d) => (d.y === 1 ? d : { x: 0, y: -1 }));
          break;
        case "ArrowDown":
          setDir((d) => (d.y === -1 ? d : { x: 0, y: 1 }));
          break;
        case "ArrowLeft":
          setDir((d) => (d.x === 1 ? d : { x: -1, y: 0 }));
          break;
        case "ArrowRight":
          setDir((d) => (d.x === -1 ? d : { x: 1, y: 0 }));
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setSnake((prev) => {
        const head = { x: prev[0].x + dir.x, y: prev[0].y + dir.y };

        if (
          head.x < 0 ||
          head.y < 0 ||
          head.x >= COLS ||
          head.y >= ROWS ||
          prev.some((s) => s.x === head.x && s.y === head.y)
        ) {
          setRunning(false);
          return prev;
        }

        const newSnake = [head, ...prev];

        if (food && head.x === food.x && head.y === food.y) {
          spawnFood();
          setScore((s) => s + 1);

          let nextSpeed = speed;
          if (buff === "fast") nextSpeed = Math.max(40, speed - 30);
          else if (buff === "slow") nextSpeed = speed + 50;
          else nextSpeed = Math.max(40, speed - 10);

          setSpeed(nextSpeed);
          return newSnake;
        }

        newSnake.pop();
        return newSnake;
      });

      if (buffTimeout && Date.now() > buffTimeout) {
        setBuff("none");
        setBuffTimeout(0);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [dir, running, speed, food, buffTimeout]);

  return (
    <>
      <canvas ref={canvasRef} className="canvas" width={WIDTH} height={HEIGHT}></canvas>
      <div className="ui">
        {!running && (
          <button onClick={() => setRunning(true)}>▶️ Start Game</button>
        )}
        <button onClick={resetGame}>🔁 Reset</button>
      </div>
      <div className="score">🏆 Score: {score}</div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<SnakeGame />);
