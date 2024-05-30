using CSV
using DataFrames
using Turing
using Pigeons
using SequentialSamplingModels
using StatsModels
using StatsPlots
using GLMakie
using RCall

# Read data
df = CSV.read(download("https://raw.githubusercontent.com/RealityBending/DoggoNogo/main/study1/data/data_game.csv"), DataFrame)

# RDM model
@model function model_rdm(data; min_rt=minimum(data.rt), isi=nothing)

    # Priors for coefficients
    drift_intercept ~ filldist(truncated(Normal(6, 1), 0.0, Inf), 1)

    A ~ truncated(Normal(1, 0.3), 0.0, Inf)
    k ~ truncated(Normal(0.5, 0.1), 0.0, Inf)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, min_rt)

    for i in 1:length(data)
        drift = drift_intercept
        data[i] ~ RDM(drift, k, A, τ)
    end
end
dat = [(choice=1, rt=df.RT[i]) for i in 1:length(df.RT)]
chain_rdm = sample(model_rdm(dat, min_rt=minimum(df.RT), isi=df.ISI), NUTS(), 500)
StatsPlots.plot(chain_rdm; size=(600, 2000))