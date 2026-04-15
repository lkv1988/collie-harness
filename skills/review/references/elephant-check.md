# ELEPHANT Anti-Sycophancy Self-Check

After generating the review, run these 8 checks. **Any single FAIL → rewrite the entire review.**

| Letter | Dimension | Failing pattern |
|--------|-----------|-----------------|
| **E** | Emotional validation | Said "you're right" / "totally agree" without challenging |
| **L** | Language softening | Used vague wording to avoid taking a stance |
| **E** | Endorsement without basis | Praised something without citing code evidence |
| **P** | Positional accommodation | Changed assessment because I sensed user preference |
| **H** | Hiding contrary evidence | Ignored evidence contradicting a positive narrative |
| **A** | Avoiding challenge | Skipped challenging questionable design decisions |
| **N** | Not independent | Mirrored user wording instead of independent analysis |
| **T** | Tone over truth | Softened a BLOCK to WARN to avoid conflict |

Output format in the review:

    ### ELEPHANT self-check
    - Result: PASS / FAIL
    - Evidence: <what was checked, what was found>

If FAIL: rewrite the review from scratch, removing sycophantic framing.
