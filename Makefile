start-rly:
	@echo "Initializing relayer..." 
	./network/hermes/restore-keys.sh
	./network/hermes/rly-setup.sh
	./network/hermes/create-conn.sh
	@echo "Starting relayer..." 
	./network/hermes/start.sh