library(ggplot2)
library(dplyr)

min_isi <- 500
max_isi <- 3500
decays <- c(500, 800, 1000, 1500)

t_grid <- seq(0, 4000, length.out = 1000)


# ------------------------------------------------------------
# Function: meanDecay corresponding to a desired clipping rate
# ------------------------------------------------------------

meanDecayForClip <- function(minISI, maxISI, prop_clipped) {
  if (minISI >= maxISI) {
    stop("minISI must be smaller than maxISI.")
  }

  if (prop_clipped <= 0 || prop_clipped >= 1) {
    stop("prop_clipped must be between 0 and 1.")
  }

  -(maxISI - minISI) / log(prop_clipped)
}

actualMeanISI <- function(minISI, maxISI, meanDecay) {
  d <- maxISI - minISI
  minISI + meanDecay * (1 - exp(-d / meanDecay))
}


# ------------------------------------------------------------
# Generate data
# ------------------------------------------------------------

df_all <- do.call(rbind, lapply(decays, function(mu) {
  rate <- 1 / mu

  # Probability that an exponential draw exceeds maxISI
  clip_prob <- exp(-(max_isi - min_isi) / mu)

  data.frame(
    Time = t_grid,
    Density = ifelse(
      t_grid >= min_isi & t_grid < max_isi,
      rate * exp(-rate * (t_grid - min_isi)) * 1000,
      NA
    ),
    Hazard = ifelse(
      t_grid >= min_isi & t_grid < max_isi,
      rate * 1000,
      NA
    ),
    Decay = factor(
      paste0(
        "mean_decay = ", mu,
        " ms (h = ", round(rate * 1000, 2),
        "/s; clipped = ", round(clip_prob * 100, 2), "%)"
      )
    )
  )
}))


# ------------------------------------------------------------
# Plot
# ------------------------------------------------------------


ggplot(df_all, aes(x = Time, color = Decay)) +

  # Density
  geom_line(
    aes(y = Density),
    linewidth = 1.1,
    na.rm = TRUE
  ) +

  # Continuous hazard
  geom_line(
    aes(y = Hazard),
    linewidth = 1.1,
    linetype = "dashed",
    na.rm = TRUE
  ) +
  geom_vline(
    xintercept = min_isi,
    color = "forestgreen",
    linetype = "dotted"
  ) +
  geom_vline(
    xintercept = max_isi,
    color = "firebrick",
    linetype = "dashed"
  ) +
  labs(
    title = "Pseudoexponential ISIs: Density and Actual Hazard",
    subtitle = paste(
      "Dashed = continuous hazard;",
      "upper ceiling creates a small discrete probability mass"
    ),
    x = "Foreperiod (ms)",
    y = "Density / Hazard (per second)",
    color = "Parameter Setting"
  ) +
  coord_cartesian(
    xlim = c(0, 4000),
    ylim = c(0, 2.2)
  ) +
  theme_minimal(base_size = 13) +
  theme(
    plot.title = element_text(face = "bold"),
    legend.position = "right",
    panel.grid.minor = element_blank()
  )


# Example: 5% clipping
cat("5% Clipping:", meanDecayForClip(
  minISI = min_isi,
  maxISI = max_isi,
  prop_clipped = 0.05
), "; Average:", actualMeanISI(
  minISI = min_isi,
  maxISI = max_isi,
  meanDecay = 1000
), "\n")
