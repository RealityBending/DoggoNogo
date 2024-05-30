using LinearAlgebra
using Statistics

function data_poly(x, degree=2; orthogonal=false)
    if orthogonal
        z = x .- mean(x)  # Center the data by subtracting its mean
        X = hcat([z .^ deg for deg in 1:degree]...)  # Create the matrix of powers up to 'degree'
        QR = qr(X)  # Perform QR decomposition
        X = Matrix(QR.Q)  # Extract the orthogonal matrix Q
    else
        X = hcat([x .^ deg for deg in 1:degree]...)  # Create the matrix of powers up to 'degree'
    end
    return X
end



# Test against R =============================================

# using BenchmarkTools
# using RCall

# x = rand(10);
# poly = data_poly(x, 2)

# @rput x;
# R"poly(x, 2, raw=TRUE)"

# y = rand(10);
# @rput y;
# R"as.data.frame(model.matrix(lm(y ~ poly(x, 2, raw=TRUE), data=data.frame(x=x, y=y))))"


# R"""
# z <- x - mean(x)
# X <- sapply(1:2, function(deg) z^deg)
# qr(X)
# # QR <- qr.Q(qr(X))
# # QR
# """

# R"""
# data_poly <- function(x, degree=2) {
#   z <- x - mean(x)
#   X <- sapply(1:degree, function(deg) z^deg)
#   QR <- qr.Q(qr(X))
#   QR
# }
# """

