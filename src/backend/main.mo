import Runtime "mo:core/Runtime";

actor {
  var highScore = 0;

  public query ({ caller }) func getHighScore() : async Nat {
    highScore;
  };

  public shared ({ caller }) func setHighScore(newScore : Nat) : async () {
    if (newScore <= highScore) { Runtime.trap("New score must be higher than current high score!") };
    highScore := newScore;
  };
};
