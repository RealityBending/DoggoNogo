using CSV
using DataFrames
using Turing
using Pigeons
using SequentialSamplingModels
using StatsModels
using StatsPlots
using GLMakie
using RCall
using Downloads


# Read data
# df = CSV.read(download("https://raw.githubusercontent.com/RealityBending/DoggoNogo/main/study1/data/data_game.csv"), DataFrame)

cd(@__DIR__)  # pwd()
include(Downloads.download("https://raw.githubusercontent.com/RealityBending/scripts/main/data_poly.jl"))

df = CSV.read("../data/data_game.csv", DataFrame)


# @rput df
# R"X <- as.data.frame(model.matrix(lm(RT ~ poly(ISI, 2), data=df)))"
# @rget X
# X = rename(X, [:Intercept, :polyISI1, :polyISI2])

# Exgaussian model
@model function model_exgaussian(data; min_rt=minimum(data.rt), isi=nothing)

    # Transform ISI into polynomials
    isi = data_poly(isi, 2; orthogonal=true)

    # Priors for coefficients
    drift_intercept ~ truncated(Normal(0.4, 1), 0.0, Inf)
    drift_isi1 ~ Normal(0, 1)
    drift_isi2 ~ Normal(0, 1)

    σ ~ truncated(Normal(0, 1), 0.0, Inf)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, Inf)

    for i in 1:length(data)
        drift = drift_intercept
        drift += drift_isi1 * isi[i, 1]
        drift += drift_isi2 * isi[i, 2]
        data[i] ~ ExGaussian(drift, σ, τ)
    end
end

m = model_exgaussian(df.RT, min_rt=minimum(df.RT), isi=df.ISI)
chain_exgaussian = sample(m, NUTS(), 500)
pt_exg = pigeons(target=TuringLogPotential(m); record=[Pigeons.traces], n_rounds=8, n_chains=4, seed=123)
pt_exg = pigeons(target=TuringLogPotential(m);
    record=[Pigeons.traces],
    variational=GaussianReference(first_tuning_round=5),
    n_chains_variational=10,
    seed=123)
chain_exgaussian2 = Chains(pt_exg)

StatsPlots.plot(chain_exgaussian; size=(600, 2000))
StatsPlots.plot(chain_exgaussian2; size=(600, 2000))

# Wald model
@model function model_wald(data; min_rt=minimum(data.rt), isi=nothing)

    # Transform ISI into polynomials
    isi = data_poly(isi, 2; orthogonal=true)

    # Priors for coefficients
    drift_intercept ~ truncated(Normal(5, 2), 0.0, Inf)
    drift_isi1 ~ Normal(0, 1)
    drift_isi2 ~ Normal(0, 1)

    # Priors
    α ~ truncated(Normal(0.5, 0.4), 0.0, Inf)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, min_rt)

    for i in 1:length(data)
        drift = drift_intercept
        drift += drift_isi1 * isi[i, :1]
        drift += drift_isi2 * isi[i, :2]
        data[i] ~ Wald(drift, α, τ)
    end
end

chain_wald = sample(model_wald(df.RT, min_rt=minimum(df.RT), isi=df.ISI), NUTS(), 500)
# StatsPlots.plot(chain_wald; size=(600, 2000))

# LNR model
@model function model_lnr(data; min_rt=minimum(data.rt), isi=nothing)

    # Transform ISI into polynomials
    isi = data_poly(isi, 2; orthogonal=true)

    # Priors for coefficients
    drift_intercept ~ filldist(Normal(-3, 1), 1)
    drift_isi1 ~ filldist(Normal(0, 1), 1)
    drift_isi2 ~ filldist(Normal(0, 1), 1)

    σ ~ filldist(truncated(Normal(0.5, 0.5), 0.0, Inf), 1)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, min_rt)

    for i in 1:length(data)
        drift = drift_intercept
        drift .+= drift_isi1 * isi[i, :1]
        drift .+= drift_isi2 * isi[i, :2]
        data[i] ~ LNR(drift, σ, τ)
    end
end

dat = [(choice=1, rt=df.RT[i]) for i in 1:length(df.RT)]
chain_lnr = sample(model_lnr(dat, min_rt=minimum(df.RT), isi=df.ISI), NUTS(), 500)
# StatsPlots.plot(chain_lnr; size=(600, 2000))


# LBA model
@model function model_lba(data; min_rt=minimum(data.rt), isi=nothing)

    # Transform ISI into polynomials
    isi = data_poly(isi, 2; orthogonal=true)

    # Priors for coefficients
    drift_intercept ~ filldist(Normal(4, 3), 1)
    drift_isi1 ~ filldist(Normal(0, 1), 1)
    drift_isi2 ~ filldist(Normal(0, 1), 1)

    A ~ truncated(Normal(0.3, 0.3), 0.0, Inf)
    k ~ truncated(Normal(0.5, 0.25), 0.0, Inf)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, min_rt)
    σ ~ filldist(truncated(Normal(1, 2), 0.0, Inf), 1)

    for i in 1:length(data)
        drift = drift_intercept
        drift .+= drift_isi1 * isi[i, 1]
        drift .+= drift_isi2 * isi[i, 2]
        data[i] ~ LBA(drift, A, k, τ, σ)
    end
end

chain_lba = sample(model_lba(dat, min_rt=minimum(df.RT), isi=df.ISI), NUTS(), 500)
# StatsPlots.plot(chain_lba; size=(600, 2000))


# RDM model
@model function model_rdm(data; min_rt=minimum(data.rt), isi=nothing)

    # Transform ISI into polynomials
    isi = data_poly(isi, 2; orthogonal=true)

    # Priors for coefficients
    drift_intercept ~ filldist(truncated(Normal(8, 2), 0.0, Inf), 1)
    drift_isi1 ~ filldist(Normal(0, 1), 1)
    drift_isi2 ~ filldist(Normal(0, 1), 1)

    A ~ truncated(Normal(0.3, 0.2), 0.0, Inf)
    k ~ truncated(Normal(1.5, 0.5), 0.0, Inf)
    τ ~ truncated(Normal(0.2, 0.05), 0.0, min_rt)

    for i in 1:length(data)
        drift = drift_intercept
        drift .+= drift_isi1 * isi[i, 1]
        drift .+= drift_isi2 * isi[i, 2]
        data[i] ~ RDM(drift, k, A, τ)
    end
end
chain_rdm = sample(model_rdm(dat, min_rt=minimum(df.RT), isi=df.ISI), NUTS(), 500)
# StatsPlots.plot(chain_rdm; size=(600, 2000))


# Model Comparison ==============================================================================
# PP Check
pred = predict(model_exgaussian([missing for i in 1:nrow(df)]; min_rt=minimum(df.RT), isi=df.ISI), chain_exgaussian)
pred_rt_exgaussian = Array(pred)

pred = predict(model_wald([missing for i in 1:nrow(df)]; min_rt=minimum(df.RT), isi=df.ISI), chain_wald)
pred_rt_wald = Array(pred)

pred = predict(model_lnr([(missing) for i in 1:nrow(df)]; min_rt=minimum(df.RT), isi=df.ISI), chain_lnr)
pred_rt_lnr = Array(pred)[:, 2:2:end]

pred = predict(model_lba([(missing) for i in 1:nrow(df)]; min_rt=minimum(df.RT), isi=df.ISI), chain_lba)
pred_rt_lba = Array(pred)[:, 2:2:end]

pred = predict(model_rdm([(missing) for i in 1:nrow(df)]; min_rt=minimum(df.RT), isi=df.ISI), chain_rdm)
pred_rt_rdm = Array(pred)[:, 2:2:end]


# Plot density
f = Figure()
ax1 = Axis(f[1, 1], title="ExGaussian")
for i in 1:500
    lines!(ax1, Makie.KernelDensity.kde(pred_rt_exgaussian[i, :]), color="orange", alpha=0.05)
end
ax2 = Axis(f[2, 1], title="Wald")
for i in 1:500
    lines!(ax2, Makie.KernelDensity.kde(pred_rt_wald[i, :]), color="green", alpha=0.05)
end
ax3 = Axis(f[3, 1], title="LNR")
for i in 1:500
    lines!(ax3, Makie.KernelDensity.kde(pred_rt_lnr[:, i]), color="red", alpha=0.05)
end
ax4 = Axis(f[4, 1], title="LBA")
for i in 1:500
    lines!(ax4, Makie.KernelDensity.kde(pred_rt_lba[:, i]), color="blue", alpha=0.05)
end
ax5 = Axis(f[5, 1], title="RDM")
for i in 1:500
    lines!(ax5, Makie.KernelDensity.kde(pred_rt_rdm[:, i]), color="purple", alpha=0.05)
end
for ax in [ax1, ax2, ax3, ax4, ax5]
    lines!(ax, Makie.KernelDensity.kde(df.RT), color="black")
    GLMakie.xlims!(ax, (0.15, 0.8))
end
f








# Model Comparison
pt_exg = pigeons(target=TuringLogPotential(model_exgaussian(df.RT, min_rt=minimum(df.RT), isi=df.ISI)), record=[Pigeons.traces], n_rounds=5)
pt_wald = pigeons(target=TuringLogPotential(model_wald(df.RT, min_rt=minimum(df.RT), isi=df.ISI)), record=[traces], n_rounds=5)
pt_lnr = pigeons(target=TuringLogPotential(model_lnr(dat, min_rt=minimum(df.RT), isi=df.ISI)), record=[traces], n_rounds=5)
pt_lba = pigeons(target=TuringLogPotential(model_lba(dat, min_rt=minimum(df.RT), isi=df.ISI)), record=[traces], n_rounds=4)
pt_rdm = pigeons(target=TuringLogPotential(model_rdm(dat, min_rt=minimum(df.RT), isi=df.ISI)), record=[traces], n_rounds=5)

mll_exg = stepping_stone(pt_exg)
mll_wald = stepping_stone(pt_wald)
mll_lnr = stepping_stone(pt_lnr)
mll_lba = stepping_stone(pt_lba)
mll_rdm = stepping_stone(pt_rdm)


# The BF is obtained by exponentiating the difference between marginal log likelihoods. 
bf = exp(mll_exg - mll_wald)
bf = exp(mll_exg - mll_lnr)
bf = exp(mll_wald - mll_lba)
bf = exp(mll_lba - mll_lnr)



