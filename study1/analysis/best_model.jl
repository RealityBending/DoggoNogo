using CSV
using DataFrames
using Turing
using SequentialSamplingModels
using StatsModels
using StatsPlots
using GLMakie
using RCall


# Predictions ===============================================================================

cd(@__DIR__)  # pwd()
include("fun_datagrid.jl")
include("fun_data_poly.jl")

df = CSV.read("../data/data_game.csv", DataFrame)


# https://cosmicmar.com/MuseInference.jl/latest/
# LBA model
@model function model_lba(data; min_rt=minimum(data.rt), isi=nothing, participant=nothing)

  # Transform ISI into polynomials
  isi = data_poly(isi, 2; orthogonal=true)
  ppt = unique(participant)

  # Priors for coefficients
  drift_intercept ~ filldist(truncated(Normal(3, 5), 0.0, Inf), 1)
  drift_isi1 ~ filldist(Normal(0, 1), 1)
  drift_isi2 ~ filldist(Normal(0, 1), 1)

  # Prior for random intercepts (requires thoughtful specification)
  # Participant-level intercepts' SD
  drift_intercept_ppt_sd ~ truncated(Normal(0, 0.1), 0.0, Inf)
  # Participant-level intercepts
  drift_intercept_ppt ~ filldist(
    Normal(0, drift_intercept_ppt_sd),
    length(ppt)
  )

  σ ~ filldist(truncated(Normal(0, 1), 0.0, Inf), 1)
  A ~ truncated(Normal(0.4, 0.4), 0.0, Inf)
  k ~ truncated(Normal(0.2, 0.2), 0.0, Inf)
  τ ~ truncated(Normal(0.2, 0.05), 0.0, min_rt)

  for i in 1:length(data)
    drift = drift_intercept .+ drift_intercept_ppt[findfirst(s -> s == participant[i], ppt)]
    drift .+= drift_isi1 * isi[i, 1]
    drift .+= drift_isi2 * isi[i, 2]
    data[i] ~ LBA(drift, A, k, τ, σ)
  end
end

# Fit 
dat = [(choice=1, rt=df.RT[i]) for i in 1:nrow(df)]
chain_lba = sample(model_lba(dat, min_rt=minimum(df.RT), isi=df.ISI, participant=df.Participant), NUTS(0.65, max_depth=8), 100)
# StatsPlots.plot(chain_lba; size=(600, 2000))
# summarystats(chain_wald)



# Predictions
grid = datagrid(df.ISI)
pred = predict(model_lba([(missing) for i in 1:length(grid)]; min_rt=minimum(df.RT), isi=grid), chain_lba)
pred = Array(pred)[:, 2:2:end]
# Remove extreme
pred[pred.>1] .= NaN
pred = DataFrame(hcat(grid, transpose(pred)), vcat(:ISI, [Symbol("iter_$i") for i in 1:500]))


@rput pred

R"""
library(tidyverse)
library(bayestestR)
library(ggdist)

pred <- reshape_iterations(pred)
# head(pred)
pred |>
  mutate(ISI = ISI) |> 
  ggplot(aes(x = ISI, y = iter_value)) +
  stat_halfeye() +
  coord_cartesian(ylim = c(0.2, 0.6)) 
"""