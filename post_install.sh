printf "\n\n######  Post install script  ###### \n"
mkdir -p ./lib
# Copy Amazon Linux 2 compiled binaries + libs over the top of whatever was built locally
cp ./pngquant ./node_modules/pngquant-bin/vendor/
cp ./libpng15.so.15 ./lib/
printf "######  DONE!  ###### \n\n"
