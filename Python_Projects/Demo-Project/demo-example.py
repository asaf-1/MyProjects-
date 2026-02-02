import random

def roll_die():
    return random.randint(1, 6)

def play_round(round_num):
    p1 = roll_die()
    p2 = roll_die()

    print(f"\n🎲 Round {round_num}")
    print(f"Player 1 rolled: {p1}")
    print(f"Player 2 rolled: {p2}")

    if p1 > p2:
        print("✅ Player 1 wins this round!")
        return 1
    elif p2 > p1:
        print("✅ Player 2 wins this round!")
        return 2
    else:
        print("🤝 It's a tie!")
        return 0

def main():
    print("🎮 Dice Game: Player 1 vs Player 2")

    # How many rounds?
    while True:
        rounds_input = input("How many rounds? (default 1): ").strip()
        if rounds_input == "":
            rounds = 1
            break
        if rounds_input.isdigit() and int(rounds_input) > 0:
            rounds = int(rounds_input)
            break
        print("Please enter a positive number (e.g. 1, 3, 5).")

    score1 = 0
    score2 = 0

    for r in range(1, rounds + 1):
        winner = play_round(r)
        if winner == 1:
            score1 += 1
        elif winner == 2:
            score2 += 1

    print("\n======================")
    print(f"🏁 Final Score:")
    print(f"Player 1: {score1}")
    print(f"Player 2: {score2}")

    if score1 > score2:
        print("🏆 Player 1 is the overall winner!")
    elif score2 > score1:
        print("🏆 Player 2 is the overall winner!")
    else:
        print("🤝 Overall result: It's a tie!")
    print("======================\n")

if __name__ == "__main__":
    main()
