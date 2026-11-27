//! Experimental safe-prime accelerator; protocol and final validation remain in Go.
use crypto_bigint::{U1024};
use crypto_primes::{random_prime, Flavor};
use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;
use wasm_bindgen::prelude::*;

fn generate(seed: [u8; 32], bits: u32) -> U1024 {
    let mut rng = ChaCha20Rng::from_seed(seed);
    loop {
        let p = random_prime::<U1024, _>(&mut rng, Flavor::Safe, bits);
        // Match Go crypto/rand.Prime: set the two most significant bits.
        if p.bit_width() == bits && bool::from(p.bit(bits - 2)) { return p; }
    }
}

/// Exactly one fresh 1024-bit safe prime. Caller must supply a fresh CSPRNG seed.
/// This returns secret factor material locally; never log or transmit it.
#[wasm_bindgen]
pub fn generate_safe_prime(seed: &[u8]) -> Result<Vec<u8>, JsValue> {
    let seed: [u8; 32] = seed.try_into().map_err(|_| JsValue::from_str("Expected 32-byte random seed"))?;
    Ok(generate(seed, 1024).to_be_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crypto_primes::is_prime;
    #[test]
    fn fixtures_are_safe_and_seeds_change_result() {
        let a = generate([1;32], 64);
        let b = generate([2;32], 64);
        assert_ne!(a,b);
        assert!(is_prime(Flavor::Safe,&a));
        assert!(is_prime(Flavor::Safe,&b));
        assert_eq!(a.bit_width(),64);
        assert_eq!(b.bit_width(),64);
    }
}
