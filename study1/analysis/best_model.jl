using CSV
using DataFrames
using Turing
using SequentialSamplingModels
using StatsModels
using StatsPlots
using GLMakie
using RCall
using Downloads

include(Downloads.download("https://raw.githubusercontent.com/RealityBending/scripts/main/data_grid.jl"))
include(Downloads.download("https://raw.githubusercontent.com/RealityBending/scripts/main/data_poly.jl"))


# Predictions ===============================================================================

cd(@__DIR__)  # pwd()
df = CSV.read("../data/data_game.csv", DataFrame)



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

  σ ~ filldist(truncated(Normal(0, 1), 0.0, Inf), 2)
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
model = model_lba(dat, min_rt=minimum(df.RT), isi=df.ISI, participant=df.Participant)
pt_lba = pigeons(target=TuringLogPotential(model);
  record=[Pigeons.traces],
  n_rounds=3,
  n_chains_variational=8,
  variational=GaussianReference(first_tuning_round=5), seed=123)
chain_lba = sample(model, NUTS(), 100)
summarystats(chain_lba)


using JLD2
jldsave("models/chain_lba.jld2"; chain_lba)
chain_lba = jldopen("models/chain_lba.jld2", "r+")["chain_lba"]

# Faster
chain_vi = rand(vi(model, ADVI(10, 1000)), 200)
# using MuseInference
# muse_result = muse(model, 0; 100, get_covariance=true)
# StatsPlots.plot(chain_lba; size=(600, 2000))
# mle_estimate = maximum_likelihood(model)
# map_estimate = maximum_a_posteriori(model)

# Parameters ===============================================================================
# Compte empirical indices (mean RT)
x = combine(groupby(df, :Participant), :RT => mean, :RT => median)
# Add drift
x[!, :Drift] = last(median(Array(chain_lba), dims=1)[1, :], 25)
x[!, :Drift_vi] = last(median(chain_vi, dims=2)[:, 1], 25)
# Plot

import AlgebraOfGraphics as aog
using CairoMakie

layers = aog.linear() + aog.visual(Scatter)
aog.draw(layers * aog.data(x) * aog.mapping(:Drift, :Drift_vi))

# Predictions ===============================================================================
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